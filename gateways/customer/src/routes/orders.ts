import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Menu as PbMenu } from "@kade/proto/kade/catalog/v1/catalog_service";
import { SubstitutionPreference } from "@kade/proto/kade/common/v1/commerce";
import {
  CancelledBy,
  Fault,
  OrderStatus as PbOrderStatus,
  type Order as PbOrder,
  type OrderLineInput,
} from "@kade/proto/kade/order/v1/order_service";
import { Thumb, type OrderRating } from "@kade/proto/kade/review/v1/review_service";
import type { OrderIssue } from "@kade/proto/kade/support/v1/support_service";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { isUuid } from "../mappers/ids.js";
import { OptionError, selectedOptions } from "../mappers/options.js";
import {
  fromIssueKind,
  fromMode,
  fromPayment,
  fromResolution,
  fromSavedAddress,
  toIssue,
  toOrder,
} from "../mappers/orders.js";
import { fromRupees, toRupees } from "../money.js";
import {
  ActiveOrder,
  IssueInput,
  IssuePreviewInput,
  Order,
  PlaceOrderInput,
  RateOrderInput,
  problems,
  refAs,
  ref,
  type IssueInput as IssueInputT,
  type Order as OrderT,
  type OrderLine,
  type PlaceOrderInput as PlaceOrderInputT,
} from "../schemas.js";
import {
  bearer,
  httpError,
  idempotencyKey,
  requireIdentity,
  restaurantIdOr404,
  type RouteDeps,
} from "./context.js";

const OrderRef = refAs<OrderT>(Order);
const IdParams = Type.Object({
  id: Type.String({ maxLength: 64, description: 'Order number ("KD-4821") or UUID.' }),
});
const notFound = () => httpError(404, "ORDER_NOT_FOUND", "This order doesn't exist.");

/** Lines -> service input, resolving option names to ids against the live menu. */
export function lineInputs(menu: PbMenu, lines: OrderLine[]): OrderLineInput[] {
  try {
    return lines.map((l) => ({
      key: l.key,
      itemId: l.itemId,
      quantity: l.qty,
      options: selectedOptions(menu, l.itemId, l.choices),
      note: l.note,
    }));
  } catch (err) {
    if (err instanceof OptionError) throw httpError(400, "OPTION_INVALID", err.message);
    throw err;
  }
}

export const orderRoutes =
  ({ up, config, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const tags = ["orders"];
    const ctx = (req: FastifyRequest, reply: FastifyReply) => callContext(req, reply);

    /** Ratings (review) and reported issues (support) live with their owners: join them on. */
    async function withJoins(req: FastifyRequest, reply: FastifyReply, orders: PbOrder[]): Promise<OrderT[]> {
      if (!orders.length) return [];
      const ids = orders.map((o) => o.id);
      const [ratings, issues] = await Promise.all([
        unary(up.review.batchGetOrderRatings.bind(up.review), { orderIds: ids }, ctx(req, reply)).then(
          (r) => r.ratings,
          (err: unknown) => {
            req.log.warn({ err }, "order ratings unavailable");
            return [] as OrderRating[];
          },
        ),
        unary(up.support.batchGetOrderIssues.bind(up.support), { orderIds: ids }, ctx(req, reply)).then(
          (r) => r.issues,
          (err: unknown) => {
            req.log.warn({ err }, "order issues unavailable");
            return [] as OrderIssue[];
          },
        ),
      ]);
      const rating = new Map(ratings.map((r) => [r.orderId, r]));
      const issue = new Map(issues.map((i) => [i.orderId, i]));
      return orders.map((o) => toOrder(o, { rating: rating.get(o.id), issue: issue.get(o.id) }));
    }

    const one = async (req: FastifyRequest, reply: FastifyReply, o: PbOrder) =>
      (await withJoins(req, reply, [o]))[0]!;

    /** By number or UUID; someone else's order is "not found", never "forbidden". */
    async function loadOrder(req: FastifyRequest, reply: FastifyReply, appId: string): Promise<PbOrder> {
      const userId = requireIdentity(req).userId;
      const res = await unary(
        up.order.getOrder.bind(up.order),
        isUuid(appId) ? { orderId: appId, orderNumber: "" } : { orderId: "", orderNumber: appId },
        ctx(req, reply),
      );
      const o = res.order;
      if (!o || (o.customer?.id && o.customer.id !== userId)) throw notFound();
      return o;
    }

    app.get(
      "/v1/orders",
      {
        schema: {
          operationId: "listOrders",
          tags,
          summary: "Every order on this account, newest first",
          security: bearer,
          response: { 200: Type.Array(OrderRef), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.order.listOrders.bind(up.order),
          {
            customerId: requireIdentity(req).userId,
            restaurantId: "",
            riderId: "",
            zoneId: "",
            statuses: [],
            lateOnly: false,
            activeOnly: false,
            query: "",
            oldestFirst: false,
            page: { pageSize: 50, pageToken: "" },
          },
          ctx(req, reply),
        );
        // Checkouts that never went through (saga still running or failed) aren't orders to the customer.
        const real = res.orders.filter(
          (o) =>
            o.status !== PbOrderStatus.ORDER_STATUS_FAILED && o.status !== PbOrderStatus.ORDER_STATUS_PENDING,
        );
        return withJoins(req, reply, real);
      },
    );

    app.get(
      "/v1/orders/active",
      {
        schema: {
          operationId: "getActiveOrder",
          tags,
          summary: "Most recent order still on its way, if any",
          security: bearer,
          response: { 200: refAs<{ order: OrderT | null }>(ActiveOrder), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.order.getActiveOrder.bind(up.order),
          { customerId: requireIdentity(req).userId },
          ctx(req, reply),
        );
        return { order: res.order ? toOrder(res.order) : null };
      },
    );

    app.get(
      "/v1/orders/:id",
      {
        schema: {
          operationId: "getOrder",
          tags,
          summary: "One order (poll every few seconds while it is live, or use /ws)",
          security: bearer,
          params: IdParams,
          response: { 200: OrderRef, ...problems(401, 404, 503, 504) },
        },
      },
      async (req, reply) => one(req, reply, await loadOrder(req, reply, req.params.id)),
    );

    app.post(
      "/v1/orders",
      {
        schema: {
          operationId: "placeOrder",
          tags,
          summary: "Checkout: runs the order saga and returns the placed (or scheduled) order",
          description:
            "Problems: CART_EMPTY, ADDRESS_REQUIRED, OUT_OF_ZONE, RESTAURANT_CLOSED, ITEM_SOLD_OUT, " +
            "PRICE_CHANGED, PROMO_*, PAYMENT_DECLINED (402), CUSTOMER_BLOCKED, OPTION_INVALID.",
          security: bearer,
          headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
          body: refAs<PlaceOrderInputT>(PlaceOrderInput),
          response: { 201: OrderRef, ...problems(400, 401, 402, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const userId = requireIdentity(req).userId;
        const input = req.body;
        if (!input.lines.length)
          throw httpError(400, "CART_EMPTY", "Your cart is empty. Add a dish before placing an order.");
        if (input.mode === "delivery" && !input.address)
          throw httpError(400, "ADDRESS_REQUIRED", "Choose where to deliver.");
        const restaurantId = restaurantIdOr404(input.restaurant.id);

        // The menu is only needed to turn option names into ids.
        const needsMenu = input.lines.some((l) => l.choices.length > 0);
        const [menuRes, cardId] = await Promise.all([
          needsMenu
            ? unary(up.catalog.getMenu.bind(up.catalog), { restaurantId }, ctx(req, reply))
            : Promise.resolve({ menu: emptyMenu(restaurantId) }),
          input.payment.type === "card" && !input.payment.cardId
            ? resolveCardId(req, reply, userId, input.payment.brand, input.payment.last4)
            : Promise.resolve(""),
        ]);
        if (!menuRes.menu) throw httpError(404, "RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");

        const res = await unary(
          up.order.placeOrder.bind(up.order),
          {
            customerId: userId,
            restaurantId,
            mode: fromMode(input.mode),
            lines: lineInputs(menuRes.menu, input.lines),
            address:
              input.mode === "delivery" && input.address
                ? fromSavedAddress(input.address, isUuid(input.address.id) ? input.address.id : "")
                : undefined,
            riderNote: input.riderNote,
            kitchenNote: "",
            cutlery: false,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
            payment: fromPayment(input.payment, cardId),
            promoCode: input.promoCode ?? "",
            tip: fromRupees(input.mode === "delivery" ? input.tip : 0),
            useCredit: input.useCredit ?? false,
            substitution:
              input.substitution === "similar"
                ? SubstitutionPreference.SUBSTITUTION_PREFERENCE_SIMILAR
                : input.substitution === "refund"
                  ? SubstitutionPreference.SUBSTITUTION_PREFERENCE_REFUND
                  : SubstitutionPreference.SUBSTITUTION_PREFERENCE_UNSPECIFIED,
            groupId: input.groupId ?? "",
            expectedTotal: input.expectedTotal !== undefined ? fromRupees(input.expectedTotal) : undefined,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          callContext(req, reply, config.PLACE_ORDER_DEADLINE_MS),
        );
        if (!res.order) throw new Error("order returned no order");
        // Saga step 4: the server-side cart is spent. Best effort; the app clears its own copy.
        unary(up.cart.clearCart.bind(up.cart), { customerId: userId }, ctx(req, reply)).catch(
          (err: unknown) => req.log.warn({ err }, "clearing the cart after checkout failed"),
        );
        return reply.code(201).send(toOrder(res.order));
      },
    );

    /** The app pays with "Visa •••• 4242": find that saved card's id. */
    async function resolveCardId(
      req: FastifyRequest,
      reply: FastifyReply,
      customerId: string,
      brand: string,
      last4: string,
    ): Promise<string> {
      const res = await unary(
        up.savedCard.listSavedCards.bind(up.savedCard),
        { customerId },
        ctx(req, reply),
      );
      const card = res.cards.find((c) => c.last4 === last4 && toBrand(c.brand) === brand.toLowerCase());
      if (!card) throw httpError(400, "CARD_NOT_FOUND", "Choose a saved card, or add one in your account.");
      return card.id;
    }

    app.post(
      "/v1/orders/:id/cancel",
      {
        schema: {
          operationId: "cancelOrder",
          tags,
          summary: "Only while scheduled or waiting for the kitchen (ORDER_ALREADY_STARTED otherwise)",
          security: bearer,
          params: IdParams,
          response: { 200: OrderRef, ...problems(400, 401, 404, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const res = await unary(
          up.order.cancelOrder.bind(up.order),
          {
            orderId: o.id,
            cancelledBy: CancelledBy.CANCELLED_BY_CUSTOMER,
            reason: "Cancelled by the customer",
            fault: Fault.FAULT_CUSTOMER,
            refund: false,
            by: req.identity?.name ?? "Customer",
            idempotencyKey: idempotencyKey(req, `order:${o.id}:cancel`),
          },
          ctx(req, reply),
        );
        return one(req, reply, res.order ?? o);
      },
    );

    app.post(
      "/v1/orders/:id/collected",
      {
        schema: {
          operationId: "markCollected",
          tags,
          summary: "Pickup orders: the customer has the food",
          security: bearer,
          params: IdParams,
          response: { 200: OrderRef, ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const res = await unary(
          up.order.markCollected.bind(up.order),
          { orderId: o.id, idempotencyKey: idempotencyKey(req, `order:${o.id}:collected`) },
          ctx(req, reply),
        );
        return one(req, reply, res.order ?? o);
      },
    );

    app.put(
      "/v1/orders/:id/tip",
      {
        schema: {
          operationId: "updateTip",
          tags,
          summary: "Card orders only (CASH_TIP_AT_DOOR for cash)",
          security: bearer,
          params: IdParams,
          body: Type.Object({ tip: Type.Integer({ minimum: 0, maximum: 100_000 }) }),
          response: { 200: OrderRef, ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const res = await unary(
          up.order.updateTip.bind(up.order),
          { orderId: o.id, tip: fromRupees(req.body.tip), idempotencyKey: idempotencyKey(req, randomUUID()) },
          ctx(req, reply),
        );
        return one(req, reply, res.order ?? o);
      },
    );

    app.post(
      "/v1/orders/:id/rating",
      {
        schema: {
          operationId: "rateOrder",
          tags,
          summary: "Rate a delivered or collected order (a second rating within 7 days replaces it)",
          security: bearer,
          params: IdParams,
          body: ref(RateOrderInput),
          response: { 200: OrderRef, ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const names = new Map(o.lines.map((l) => [l.itemId, l.name]));
        await unary(
          up.review.submitOrderRating.bind(up.review),
          {
            orderId: o.id,
            customerId: requireIdentity(req).userId,
            riderStars: req.body.riderStars ?? 0,
            riderTags: req.body.riderTags,
            dishes: Object.entries(req.body.dishes).map(([itemId, t]) => ({
              itemId,
              itemName: names.get(itemId) ?? "",
              thumb: t === "up" ? Thumb.THUMB_UP : Thumb.THUMB_DOWN,
            })),
            restaurantStars: 0,
            comment: req.body.comment,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          ctx(req, reply),
        );
        return one(req, reply, o);
      },
    );

    app.post(
      "/v1/orders/:id/issues/preview",
      {
        schema: {
          operationId: "previewIssue",
          tags,
          summary: "What would be paid back for a problem, shown before sending",
          security: bearer,
          params: IdParams,
          body: refAs<Pick<IssueInputT, "kind" | "lines">>(IssuePreviewInput),
          response: { 200: Type.Object({ amount: Type.Integer() }), ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const res = await unary(
          up.support.previewOrderIssue.bind(up.support),
          {
            orderId: o.id,
            kind: fromIssueKind(req.body.kind),
            lines: req.body.lines.map((l) => ({ lineKey: l.key, quantity: l.qty })),
          },
          ctx(req, reply),
        );
        return { amount: toRupees(res.amount) };
      },
    );

    app.post(
      "/v1/orders/:id/issues",
      {
        schema: {
          operationId: "reportIssue",
          tags,
          summary: "Report a problem; credit refunds land straight away",
          security: bearer,
          params: IdParams,
          body: refAs<IssueInputT>(IssueInput),
          response: { 200: OrderRef, ...problems(400, 401, 404, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = await loadOrder(req, reply, req.params.id);
        const b = req.body;
        const res = await unary(
          up.support.reportOrderIssue.bind(up.support),
          {
            orderId: o.id,
            customerId: requireIdentity(req).userId,
            kind: fromIssueKind(b.kind),
            lines: b.lines.filter((l) => l.qty > 0).map((l) => ({ lineKey: l.key, quantity: l.qty })),
            note: b.note,
            photoRef: "",
            photoName: b.photoName ?? "",
            resolution: fromResolution(b.resolution),
            idempotencyKey: idempotencyKey(req, `order:${o.id}:issue`),
          },
          callContext(req, reply, 5_000),
        );
        const order = await one(req, reply, o);
        if (!order.issue && res.issue) return { ...order, issue: toIssue(res.issue) };
        return order;
      },
    );
  };

const emptyMenu = (restaurantId: string): PbMenu => ({
  restaurantId,
  sections: [],
  popular: [],
  optionGroups: [],
  version: 0,
  updatedAt: undefined,
});

const toBrand = (b: number) => ({ 1: "visa", 2: "mastercard", 3: "amex" })[b] ?? "";
