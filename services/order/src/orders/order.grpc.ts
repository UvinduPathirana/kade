import { status } from "@grpc/grpc-js";
import { Inject, Injectable } from "@nestjs/common";
import { FulfilmentMode, PaymentMethodKind } from "@kade/proto/kade/common/v1/commerce";
import {
  CancelledBy,
  Fault,
  OrderServiceService,
  OrderStatus,
  PlaceOrderRequest,
  type AddOrderNoteRequest,
  type AddOrderNoteResponse,
  type BatchGetOrdersRequest,
  type BatchGetOrdersResponse,
  type CancelOrderRequest,
  type CancelOrderResponse,
  type GetActiveOrderRequest,
  type GetActiveOrderResponse,
  type GetOrderRequest,
  type GetOrderResponse,
  type ListOrderRefundsRequest,
  type ListOrderRefundsResponse,
  type ListOrdersRequest,
  type ListOrdersResponse,
  type MarkCollectedRequest,
  type MarkCollectedResponse,
  type Order,
  type PlaceOrderResponse,
  type RefundOrderRequest,
  type RefundOrderResponse,
  type UpdateTipRequest,
  type UpdateTipResponse,
} from "@kade/proto/kade/order/v1/order_service";
import { createHash, randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { PAYMENT, type PaymentPort } from "../clients/ports.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import {
  DomainError,
  failedPrecondition,
  invalidArgument,
  notFound,
  permissionDenied,
} from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { TemporalService } from "../temporal/temporal.service.js";
import { cancelSignal, collectedSignal } from "../workflows/signals.js";
import { assertAccess, canAccess, isStaff } from "./access.js";
import { asDomainError } from "./dependency-errors.js";
import { orderEvents } from "./events.js";
import { formatRs, lkr, minor } from "./money.js";
import { OrderRepository } from "./order.repository.js";
import { OrderStore } from "./order.store.js";
import { RefundRepository } from "./refund.repository.js";
import { RefundService } from "./refund.service.js";
import { isFinal } from "./status.js";
import { addTimeline, applyCancelled } from "./transitions.js";

const MAX_LINES = 50;
const MAX_QTY = 50;
const MAX_TIP_MINOR = 500_000;
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 3_600_000;
const POLL_MS = 150;

/** kade.order.v1.OrderService. The saga itself is the Temporal workflow; RPCs start and signal it. */
@GrpcService(OrderServiceService)
@Injectable()
export class OrderGrpcService implements GrpcHandlers<OrderServiceService> {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(Database) private readonly database: Database,
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(OrderStore) private readonly store: OrderStore,
    @Inject(RefundRepository) private readonly refundRows: RefundRepository,
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(TemporalService) private readonly temporal: TemporalService,
    @Inject(PAYMENT) private readonly payment: PaymentPort,
  ) {}

  // ------------------------------------------------------------------ PlaceOrder

  async placeOrder(req: PlaceOrderRequest, ctx: RequestContext): Promise<PlaceOrderResponse> {
    const customerId = req.customerId || ctx.userId || "";
    if (ctx.userId && !isStaff(ctx) && req.customerId && req.customerId !== ctx.userId) {
      throw permissionDenied("PERMISSION_DENIED", "You can only order for yourself.");
    }
    const request: PlaceOrderRequest = { ...req, customerId };
    validatePlaceOrder(request);
    const requestHash = createHash("sha256")
      .update(PlaceOrderRequest.encode(request).finish())
      .digest("base64url");

    let record = await this.orders.findByIdempotencyKey(this.database.db, customerId, request.idempotencyKey);
    if (!record) {
      const now = new Date();
      const order = await this.database.transaction(ctx, async (tx) => {
        const draft = newOrder(request, await this.orders.nextOrderNumber(tx), now);
        const inserted = await this.orders.insert(tx, draft, request, requestHash);
        return inserted ? draft : undefined;
      });
      record = order
        ? { order, request, requestHash, idempotencyKey: request.idempotencyKey }
        : await this.orders.findByIdempotencyKey(this.database.db, customerId, request.idempotencyKey);
      if (!record) throw new Error("order vanished after idempotent insert");
    }
    if (record.requestHash !== requestHash) {
      throw failedPrecondition(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different order.",
      );
    }

    if (record.order.status === OrderStatus.ORDER_STATUS_PENDING) {
      try {
        await this.temporal.startOrderWorkflow(record.order.id);
      } catch (err) {
        this.logger.error({ err, orderId: record.order.id }, "could not start the order workflow");
        throw new DomainError(
          status.UNAVAILABLE,
          "ORDER_SERVICE_UNAVAILABLE",
          "We couldn't place your order right now and nothing was charged. Please try again.",
        );
      }
    }
    const waitMs = Math.min(
      this.config.PLACE_ORDER_WAIT_MS,
      Math.max(0, (ctx.remainingMs() ?? Infinity) - 300),
    );
    const order = await this.waitFor(
      record.order.id,
      (o) => o.status !== OrderStatus.ORDER_STATUS_PENDING,
      waitMs,
      ctx.signal,
    );
    if (order.status === OrderStatus.ORDER_STATUS_FAILED) {
      const code =
        order.failureReason === "SERVICE_UNAVAILABLE" ? status.UNAVAILABLE : status.FAILED_PRECONDITION;
      throw new DomainError(
        code,
        order.failureReason || "ORDER_FAILED",
        order.failureMessage || "We couldn't place your order.",
        {
          orderId: order.id,
          orderNumber: order.orderNumber,
        },
      );
    }
    return { order };
  }

  // ------------------------------------------------------------------ reads

  async getOrder(req: GetOrderRequest, ctx: RequestContext): Promise<GetOrderResponse> {
    const order = await this.load(req.orderId, req.orderNumber);
    assertAccess(ctx, order);
    return { order };
  }

  async batchGetOrders(req: BatchGetOrdersRequest, ctx: RequestContext): Promise<BatchGetOrdersResponse> {
    if (req.orderIds.length > 100)
      throw invalidArgument("TOO_MANY_IDS", "Ask for at most 100 orders at a time.");
    const found = await this.orders.findMany(this.database.db, req.orderIds);
    return { orders: found.filter((o) => canAccess(ctx, o)) };
  }

  async listOrders(req: ListOrdersRequest, ctx: RequestContext): Promise<ListOrdersResponse> {
    const { riderId } = req;
    let { customerId, restaurantId } = req;
    if (ctx.userId && !isStaff(ctx)) {
      if (ctx.hasRole("merchant_staff") || ctx.hasRole("merchant_owner")) {
        if (ctx.outletId) restaurantId = ctx.outletId;
      } else if (ctx.hasRole("rider")) {
        if (!riderId) throw permissionDenied("PERMISSION_DENIED", "Riders can only list their own trips.");
      } else {
        customerId = ctx.userId;
      }
    }
    const size = Math.min(Math.max(req.page?.pageSize || 20, 1), 100);
    const offset = decodeToken(req.page?.pageToken ?? "");
    const { orders, total } = await this.orders.list(this.database.db, {
      customerId: customerId || undefined,
      restaurantId: restaurantId || undefined,
      riderId: riderId || undefined,
      zoneId: req.zoneId || undefined,
      statuses: req.statuses.filter((s) => s > 0),
      lateOnly: req.lateOnly,
      activeOnly: req.activeOnly,
      placedAfter: req.placedAfter,
      placedBefore: req.placedBefore,
      query: req.query,
      oldestFirst: req.oldestFirst,
      offset,
      limit: size,
    });
    const next = offset + orders.length;
    return { orders, page: { nextPageToken: next < total ? encodeToken(next) : "", totalSize: total } };
  }

  async getActiveOrder(req: GetActiveOrderRequest, ctx: RequestContext): Promise<GetActiveOrderResponse> {
    const customerId = ctx.userId && !isStaff(ctx) ? ctx.userId : req.customerId;
    if (!customerId) throw invalidArgument("CUSTOMER_REQUIRED", "Which customer?");
    return { order: await this.orders.findActiveForCustomer(this.database.db, customerId) };
  }

  async listOrderRefunds(
    req: ListOrderRefundsRequest,
    ctx: RequestContext,
  ): Promise<ListOrderRefundsResponse> {
    const order = await this.load(req.orderId);
    assertAccess(ctx, order);
    return { refunds: await this.refundRows.listForOrder(this.database.db, order.id) };
  }

  // ------------------------------------------------------------------ changes

  async cancelOrder(req: CancelOrderRequest, ctx: RequestContext): Promise<CancelOrderResponse> {
    const order = await this.load(req.orderId);
    assertAccess(ctx, order);
    const staff = !ctx.userId || isStaff(ctx);
    const cancelledBy = !staff
      ? CancelledBy.CANCELLED_BY_CUSTOMER
      : req.cancelledBy || (ctx.userId ? CancelledBy.CANCELLED_BY_OPS : CancelledBy.CANCELLED_BY_SYSTEM);
    if (order.status === OrderStatus.ORDER_STATUS_CANCELLED) return { order }; // retry of a cancel that worked
    if (isFinal(order.status)) {
      throw failedPrecondition(
        "ORDER_ALREADY_FINISHED",
        "This order is already finished and can't be cancelled.",
      );
    }
    if (order.status === OrderStatus.ORDER_STATUS_PENDING) {
      throw failedPrecondition(
        "ORDER_NOT_CANCELLABLE",
        "This order is still being placed. Try again in a moment.",
      );
    }
    if (cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER && !customerMayCancel(order.status)) {
      throw this.alreadyStarted(order);
    }
    const signal = {
      cancelledBy,
      reason:
        req.reason.trim() ||
        (cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER ? "Cancelled by the customer" : "Cancelled"),
      fault:
        req.fault ||
        (cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER ? Fault.FAULT_CUSTOMER : Fault.FAULT_UNSPECIFIED),
      refund: staff && req.refund,
      by:
        req.by ||
        (cancelledBy === CancelledBy.CANCELLED_BY_CUSTOMER ? order.customer?.name || "Customer" : "Kadé"),
    };
    const signalled = await this.temporal.signal(order.id, cancelSignal, signal);
    if (!signalled) {
      // No running workflow (e.g. lost in a Temporal reset): record the cancellation directly.
      this.logger.warn({ orderId: order.id }, "cancel without a running workflow; nothing to compensate");
      const { order: updated } = await this.store.mutate(ctx, order.id, (o) =>
        applyCancelled(o, {
          ...signal,
          at: new Date(),
          cancelledBy: signal.cancelledBy,
          fault: signal.fault,
        }),
      );
      return { order: updated };
    }
    const after = await this.waitFor(
      order.id,
      (o) => o.status !== order.status,
      this.changeWaitMs(ctx),
      ctx.signal,
    );
    if (after.status === OrderStatus.ORDER_STATUS_CANCELLED) return { order: after };
    if (after.status === order.status) {
      throw new DomainError(
        status.UNAVAILABLE,
        "ORDER_BUSY",
        "We couldn't cancel this just now. Try again in a moment.",
      );
    }
    throw this.alreadyStarted(after);
  }

  async markCollected(req: MarkCollectedRequest, ctx: RequestContext): Promise<MarkCollectedResponse> {
    const order = await this.load(req.orderId);
    assertAccess(ctx, order);
    if (order.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP) {
      throw failedPrecondition("ORDER_NOT_PICKUP", "Only pickup orders are collected.");
    }
    if (order.status === OrderStatus.ORDER_STATUS_COLLECTED) return { order };
    const collectable: OrderStatus[] = [
      OrderStatus.ORDER_STATUS_ACCEPTED,
      OrderStatus.ORDER_STATUS_PREPARING,
      OrderStatus.ORDER_STATUS_READY,
    ];
    if (!collectable.includes(order.status)) {
      throw failedPrecondition("ORDER_NOT_READY", "This order isn't ready to collect.");
    }
    await this.temporal.signal(order.id, collectedSignal, { by: isStaff(ctx) ? "Kadé" : "" });
    const after = await this.waitFor(
      order.id,
      (o) => o.status === OrderStatus.ORDER_STATUS_COLLECTED || isFinal(o.status),
      this.changeWaitMs(ctx),
      ctx.signal,
    );
    if (after.status !== OrderStatus.ORDER_STATUS_COLLECTED) {
      throw new DomainError(
        status.UNAVAILABLE,
        "ORDER_BUSY",
        "We couldn't update this order just now. Try again.",
      );
    }
    return { order: after };
  }

  async updateTip(req: UpdateTipRequest, ctx: RequestContext): Promise<UpdateTipResponse> {
    const current = await this.load(req.orderId);
    assertAccess(ctx, current);
    const tip = minor(req.tip);
    if (!Number.isSafeInteger(tip) || tip < 0 || tip > MAX_TIP_MINOR) {
      throw invalidArgument("TIP_INVALID", `Tips go from Rs 0 to ${formatRs(MAX_TIP_MINOR)}.`, {
        field: "tip",
      });
    }
    if (current.payment?.kind !== PaymentMethodKind.PAYMENT_METHOD_KIND_CARD) {
      throw failedPrecondition("CASH_TIP_AT_DOOR", "Cash tips are given to the rider at the door.");
    }
    if (current.mode !== FulfilmentMode.FULFILMENT_MODE_DELIVERY) {
      throw failedPrecondition("TIP_DELIVERY_ONLY", "Tips go to the rider, so they're for delivery orders.");
    }
    if (minor(current.totals?.tip) === tip) return { order: current };
    const adjustable: OrderStatus[] = [
      OrderStatus.ORDER_STATUS_SCHEDULED,
      OrderStatus.ORDER_STATUS_PLACED,
      OrderStatus.ORDER_STATUS_ACCEPTED,
      OrderStatus.ORDER_STATUS_PREPARING,
      OrderStatus.ORDER_STATUS_READY,
    ];
    if (!adjustable.includes(current.status)) {
      throw failedPrecondition(
        "TIP_LOCKED",
        "The card has already been charged for this order, so the tip can't change now.",
      );
    }
    const newTotal = minor(current.totals?.total) - minor(current.totals?.tip) + tip;
    if (current.paymentId) {
      try {
        await this.payment.adjust({
          paymentId: current.paymentId,
          newAmount: lkr(newTotal),
          idempotencyKey: `order:${current.id}:tip:${req.idempotencyKey || tip}`,
        });
      } catch (err) {
        throw asDomainError(err, "We couldn't change the tip right now. Try again in a minute.");
      }
    }
    const { order } = await this.store.mutate(ctx, current.id, (o) => {
      if (!o.totals) return [];
      const previous = o.totals.tip;
      if (minor(previous) === tip) return [];
      const at = new Date();
      o.totals = { ...o.totals, tip: lkr(tip), total: lkr(minor(o.totals.total) - minor(previous) + tip) };
      o.updatedAt = at;
      addTimeline(o, at, o.status, tip > 0 ? `Tip changed to ${formatRs(tip)}` : "Tip removed");
      return [orderEvents.tipUpdated(o, previous, at)];
    });
    return { order };
  }

  async refundOrder(req: RefundOrderRequest, ctx: RequestContext): Promise<RefundOrderResponse> {
    if (ctx.userId && !isStaff(ctx)) {
      throw permissionDenied("PERMISSION_DENIED", "Refunds are made by Kadé support.");
    }
    const order = await this.load(req.orderId);
    const result = await this.refunds.refund(ctx, {
      orderId: order.id,
      amountMinor: minor(req.amount),
      method: req.method,
      reason: req.reason.trim(),
      by: req.by,
      ticketId: req.ticketId,
      idempotencyKey: req.idempotencyKey,
      actor: ctx.userId
        ? { userId: ctx.userId, roles: [...ctx.roles], outletId: ctx.outletId ?? "" }
        : undefined,
    });
    return result;
  }

  async addOrderNote(req: AddOrderNoteRequest, ctx: RequestContext): Promise<AddOrderNoteResponse> {
    if (ctx.userId && !isStaff(ctx)) throw permissionDenied("PERMISSION_DENIED", "Notes are for Kadé staff.");
    const body = req.body.trim();
    if (!body) throw invalidArgument("NOTE_REQUIRED", "Write something first.", { field: "body" });
    if (body.length > 2_000) throw invalidArgument("NOTE_TOO_LONG", "Keep notes under 2,000 characters.");
    const order = await this.load(req.orderId);
    const { order: updated } = await this.store.mutate(
      ctx,
      order.id,
      (o) => {
        const at = new Date();
        o.notes.push({ id: uuidv7(), at, author: req.author || "Kadé", body });
        o.updatedAt = at;
        return [];
      },
      { save: true },
    );
    return { order: updated };
  }

  // ------------------------------------------------------------------ helpers

  private async load(orderId: string, orderNumber = ""): Promise<Order> {
    const record = orderId
      ? await this.orders.findById(this.database.db, orderId)
      : orderNumber
        ? await this.orders.findByNumber(this.database.db, orderNumber)
        : undefined;
    if (!orderId && !orderNumber) throw invalidArgument("ORDER_ID_REQUIRED", "Which order?");
    if (!record) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.");
    return record.order;
  }

  /** Polls the order row until `done` (the workflow writes it) or the time is up. */
  private async waitFor(
    orderId: string,
    done: (o: Order) => boolean,
    ms: number,
    signal: AbortSignal,
  ): Promise<Order> {
    const until = Date.now() + ms;
    for (;;) {
      const record = await this.orders.findById(this.database.db, orderId);
      if (!record) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.");
      if (done(record.order) || Date.now() >= until || signal.aborted) return record.order;
      await sleep(POLL_MS);
    }
  }

  private changeWaitMs(ctx: RequestContext): number {
    return Math.min(10_000, Math.max(0, (ctx.remainingMs() ?? Infinity) - 300));
  }

  private alreadyStarted(order: Order): DomainError {
    return failedPrecondition(
      "ORDER_ALREADY_STARTED",
      `${order.restaurant?.name || "The restaurant"} has already started on your order, so it can't be cancelled here.`,
    );
  }
}

const customerMayCancel = (s: OrderStatus) =>
  s === OrderStatus.ORDER_STATUS_SCHEDULED || s === OrderStatus.ORDER_STATUS_PLACED;

export function validatePlaceOrder(req: PlaceOrderRequest, now = new Date()): void {
  if (!req.customerId) throw invalidArgument("CUSTOMER_REQUIRED", "Sign in to place an order.");
  if (!req.idempotencyKey) {
    throw invalidArgument("IDEMPOTENCY_KEY_REQUIRED", "idempotency_key is required.", {
      field: "idempotency_key",
    });
  }
  if (!req.restaurantId) throw invalidArgument("RESTAURANT_REQUIRED", "Choose a restaurant first.");
  if (req.lines.length === 0) {
    throw failedPrecondition("CART_EMPTY", "Your cart is empty. Add a dish before placing an order.");
  }
  if (req.lines.length > MAX_LINES)
    throw invalidArgument("CART_TOO_BIG", `Orders can have up to ${MAX_LINES} dishes.`);
  for (const l of req.lines) {
    if (!l.itemId || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QTY) {
      throw invalidArgument("LINE_INVALID", `Each dish needs a quantity from 1 to ${MAX_QTY}.`);
    }
  }
  if (
    req.mode !== FulfilmentMode.FULFILMENT_MODE_DELIVERY &&
    req.mode !== FulfilmentMode.FULFILMENT_MODE_PICKUP
  ) {
    throw invalidArgument("MODE_REQUIRED", "Choose delivery or pickup.", { field: "mode" });
  }
  if (req.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY && !req.address?.location) {
    throw failedPrecondition("ADDRESS_REQUIRED", "Choose where to deliver.");
  }
  const kind = req.payment?.kind;
  if (
    kind !== PaymentMethodKind.PAYMENT_METHOD_KIND_CARD &&
    kind !== PaymentMethodKind.PAYMENT_METHOD_KIND_CASH
  ) {
    throw invalidArgument("PAYMENT_METHOD_REQUIRED", "Choose how you'll pay.", { field: "payment" });
  }
  const tip = minor(req.tip);
  if (tip < 0 || tip > MAX_TIP_MINOR) throw invalidArgument("TIP_INVALID", "That tip doesn't look right.");
  if (req.scheduledFor && req.scheduledFor.getTime() - now.getTime() > MAX_SCHEDULE_AHEAD_MS) {
    throw invalidArgument("SCHEDULE_TOO_FAR", "You can schedule up to 7 days ahead.");
  }
}

export function newOrder(req: PlaceOrderRequest, orderNumber: string, now: Date): Order {
  const scheduled =
    req.scheduledFor && req.scheduledFor.getTime() > now.getTime() ? req.scheduledFor : undefined;
  return {
    id: uuidv7(),
    orderNumber,
    status: OrderStatus.ORDER_STATUS_PENDING,
    mode: req.mode,
    customer: { id: req.customerId, name: "", phone: "" },
    restaurant: {
      id: req.restaurantId,
      name: "",
      imageId: "",
      area: "",
      address: "",
      phone: "",
      zoneId: "",
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      discountPercent: 0,
    },
    lines: req.lines.map((l, i) => ({
      key: l.key || `line-${i + 1}`,
      itemId: l.itemId,
      name: "",
      quantity: l.quantity,
      options: l.options,
      choiceNames: [],
      note: l.note,
      sectionId: "",
    })),
    address: req.mode === FulfilmentMode.FULFILMENT_MODE_DELIVERY ? req.address : undefined,
    riderNote: req.riderNote,
    kitchenNote: req.kitchenNote,
    cutlery: req.cutlery,
    scheduledFor: scheduled,
    payment: req.payment,
    paymentId: "",
    substitution: req.substitution,
    groupId: req.groupId,
    zoneId: "",
    distanceKm: 0,
    deliveryCode: String(randomInt(0, 10_000)).padStart(4, "0"),
    deliveryId: "",
    createdAt: now,
    updatedAt: now,
    prepMinutes: 0,
    refunded: lkr(0),
    timeline: [{ at: now, status: OrderStatus.ORDER_STATUS_PENDING, label: "Checkout started", by: "" }],
    notes: [],
    failureReason: "",
    failureMessage: "",
    customerRepeatCount: 0,
  };
}

const encodeToken = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");
function decodeToken(token: string): number {
  if (!token) return 0;
  const m = /^o:(\d+)$/.exec(Buffer.from(token, "base64url").toString());
  if (!m) throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.");
  return Number(m[1]);
}
