import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ListNearbyRidersRequest, ReassignRiderRequest } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import {
  AddOrderNoteRequest,
  CancelledBy,
  CancelOrderRequest,
  GetOrderRequest,
  ListOrdersRequest,
  RefundOrderRequest,
  type Order,
} from "@kade/proto/kade/order/v1/order_service";
import { GetCustomerRequest } from "@kade/proto/kade/profile/v1/profile_service";
import { Type } from "typebox";
import { badRequest, notFound, type Ctx } from "../context.js";
import { isUuid, personId, personUuid } from "../ids.js";
import { allPages, formatRs, PAGE, rs, soft } from "../lib.js";
import {
  FAULT_LABELS,
  FAULT_TO_PROTO,
  isHidden,
  REFUND_METHOD_TO_PROTO,
  toOrderView,
} from "../mappers/orders.js";
import { RIDER_STATUS, VEHICLE } from "../mappers/partners.js";
import { fromRupees } from "../money.js";
import { SMALL_REFUND_LIMIT } from "../permissions.js";
import { FAULTS, listOf, NearbyRider, OrderView, problems, ref } from "../schemas.js";

/** The console sends order numbers ("KD-4821"); attention items may carry the UUID. */
export async function getOrder(ctx: Ctx, id: string): Promise<Order> {
  const res = await ctx.rpc(
    ctx.up.order,
    "getOrder",
    GetOrderRequest.fromPartial(isUuid(id) ? { orderId: id } : { orderNumber: id }),
  );
  if (!res.order) throw notFound(`Order ${id}`);
  return res.order;
}

const idem = (h: string | undefined) => h || randomUUID();
const idemHeader = Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) });
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
const security = [{ bearer: [] }];
const tags = ["orders"];

export const orderRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const view = async (ctx: Ctx, o: Order, email = "") =>
    toOrderView(o, await soft(ctx.log, "zones", ctx.zones(), []), Date.now(), email);

  app.get(
    "/v1/orders",
    {
      config: { permission: "orders.view" },
      schema: {
        operationId: "listOrders",
        tags,
        security,
        summary: "Orders placed in the last 7 days, newest first (ops list).",
        response: { 200: listOf(OrderView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const since = new Date(Date.now() - 7 * 24 * 3_600_000);
      const [orders, zones] = await Promise.all([
        allPages(async (pageToken) => {
          const res = await ctx.rpc(
            ctx.up.order,
            "listOrders",
            ListOrdersRequest.fromPartial({ placedAfter: since, page: { pageSize: PAGE, pageToken } }),
          );
          return { items: res.orders, next: res.page?.nextPageToken ?? "" };
        }, 10),
        soft(ctx.log, "zones", ctx.zones(), []),
      ]);
      const now = Date.now();
      return orders
        .filter((o) => !isHidden(o))
        .map((o) => toOrderView(o, zones, now))
        .sort((a, b) => b.placedAt - a.placedAt);
    },
  );

  app.get(
    "/v1/orders/:id",
    {
      config: { permission: "orders.view" },
      schema: {
        operationId: "getOrder",
        tags,
        security,
        summary: "One order by order number (KD-4821) or id, with the customer's email.",
        params: IdParams,
        response: { 200: ref(OrderView), ...problems(401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const o = await getOrder(ctx, req.params.id);
      const customer = o.customer?.id
        ? await soft(
            ctx.log,
            "customer email",
            ctx.rpc(
              ctx.up.customers,
              "getCustomer",
              GetCustomerRequest.fromPartial({ customerId: o.customer.id }),
            ),
            undefined,
          )
        : undefined;
      return view(ctx, o, customer?.customer?.email ?? "");
    },
  );

  app.get(
    "/v1/orders/:id/nearby-riders",
    {
      config: { permission: "orders.reassign" },
      schema: {
        operationId: "listNearbyRiders",
        tags,
        security,
        summary: "Riders near the order's restaurant, free ones first (dispatch).",
        params: IdParams,
        response: { 200: listOf(NearbyRider), ...problems(401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const o = await getOrder(ctx, req.params.id);
      const [res, zones] = await Promise.all([
        ctx.rpc(
          ctx.up.dispatchOps,
          "listNearbyRiders",
          ListNearbyRidersRequest.fromPartial({ orderId: o.id, limit: 8 }),
        ),
        soft(ctx.log, "zones", ctx.zones(), []),
      ]);
      return res.riders
        .filter((n) => n.rider && n.rider.id !== o.rider?.riderId)
        .map((n) => {
          const r = n.rider!;
          const zoneId = r.positionZoneId || r.zoneIds[0] || "";
          return {
            id: personId(r.id),
            name: r.name,
            vehicle: VEHICLE[r.vehicle?.type ?? 0] ?? "motorbike",
            status: RIDER_STATUS[r.status] ?? "online",
            zoneCode: zones.find((z) => z.id === zoneId)?.code ?? zoneId,
            km: Math.round(n.km * 10) / 10,
            cashHeld: rs(r.cashHeld),
            rating: r.rating,
          };
        });
    },
  );

  app.post(
    "/v1/orders/:id/reassign",
    {
      config: { permission: "orders.reassign" },
      schema: {
        operationId: "reassignRider",
        tags,
        security,
        summary: "Give the delivery to another rider (dispatch). Audited.",
        params: IdParams,
        headers: idemHeader,
        body: Type.Object({
          riderId: Type.String({ minLength: 1 }),
          reason: Type.String({ maxLength: 500 }),
        }),
        response: { 200: ref(OrderView), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const o = await getOrder(ctx, req.params.id);
      await ctx.rpc(
        ctx.up.dispatchOps,
        "reassignRider",
        ReassignRiderRequest.fromPartial({
          orderId: o.id,
          riderId: personUuid(req.body.riderId),
          reason: req.body.reason,
          by: await ctx.actorName(),
          idempotencyKey: idem(req.headers["idempotency-key"]),
        }),
      );
      const after = await getOrder(ctx, o.id);
      await ctx.audit({
        action: `Assigned ${after.rider?.name || req.body.riderId}`,
        recordType: "order",
        recordId: after.orderNumber || o.id,
        detail: req.body.reason,
      });
      return view(ctx, after);
    },
  );

  app.post(
    "/v1/orders/:id/refunds",
    {
      config: { permission: ["orders.refundSmall", "orders.refundAny"] },
      schema: {
        operationId: "refundOrder",
        tags,
        security,
        summary: `Refund to card or Kadé credit (order). Over Rs ${SMALL_REFUND_LIMIT} needs orders.refundAny. Audited.`,
        params: IdParams,
        headers: idemHeader,
        body: Type.Object({
          amount: Type.Integer({ minimum: 1 }),
          method: Type.Union([Type.Literal("card"), Type.Literal("credit")]),
          reason: Type.String({ maxLength: 500 }),
        }),
        response: { 200: ref(OrderView), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { amount, method, reason } = req.body;
      await ctx.need(
        amount > SMALL_REFUND_LIMIT ? "orders.refundAny" : ["orders.refundSmall", "orders.refundAny"],
      );
      const o = await getOrder(ctx, req.params.id);
      const left = rs(o.totals?.total) - rs(o.refunded);
      if (amount > left)
        throw badRequest(
          "REFUND_EXCEEDS_REMAINING",
          `Refund between Rs 1 and ${formatRs(left)}, the amount not yet refunded.`,
        );
      const res = await ctx.rpc(
        ctx.up.order,
        "refundOrder",
        RefundOrderRequest.fromPartial({
          orderId: o.id,
          amount: fromRupees(amount),
          method: REFUND_METHOD_TO_PROTO[method],
          reason,
          by: await ctx.actorName(),
          idempotencyKey: idem(req.headers["idempotency-key"]),
        }),
      );
      await ctx.audit({
        action: `Refunded ${formatRs(amount)} to ${method === "card" ? "card" : "Kadé credit"}`,
        recordType: "order",
        recordId: o.orderNumber || o.id,
        detail: reason,
      });
      return view(ctx, res.order ?? (await getOrder(ctx, o.id)));
    },
  );

  app.post(
    "/v1/orders/:id/cancel",
    {
      config: { permission: "orders.cancel" },
      schema: {
        operationId: "cancelOrder",
        tags,
        security,
        summary: "Cancel as ops with a reason and fault, optionally refunding what's left (order). Audited.",
        params: IdParams,
        headers: idemHeader,
        body: Type.Object({
          reason: Type.String({ minLength: 1, maxLength: 500 }),
          fault: Type.Enum(FAULTS),
          refund: Type.Boolean(),
        }),
        response: { 200: ref(OrderView), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { reason, fault, refund } = req.body;
      const o = await getOrder(ctx, req.params.id);
      const res = await ctx.rpc(
        ctx.up.order,
        "cancelOrder",
        CancelOrderRequest.fromPartial({
          orderId: o.id,
          cancelledBy: CancelledBy.CANCELLED_BY_OPS,
          reason,
          fault: FAULT_TO_PROTO[fault],
          refund,
          by: await ctx.actorName(),
          idempotencyKey: idem(req.headers["idempotency-key"]),
        }),
      );
      await ctx.audit({
        action: "Cancelled order",
        recordType: "order",
        recordId: o.orderNumber || o.id,
        detail: `${reason}. ${FAULT_LABELS[fault]} at fault.`,
      });
      return view(ctx, res.order ?? (await getOrder(ctx, o.id)));
    },
  );

  app.post(
    "/v1/orders/:id/notes",
    {
      config: { permission: "orders.view" },
      schema: {
        operationId: "addOrderNote",
        tags,
        security,
        summary: "Internal ops note on the order. Audited.",
        params: IdParams,
        body: Type.Object({ body: Type.String({ minLength: 1, maxLength: 2000 }) }),
        response: { 200: ref(OrderView), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { body } = req.body;
      const o = await getOrder(ctx, req.params.id);
      const res = await ctx.rpc(
        ctx.up.order,
        "addOrderNote",
        AddOrderNoteRequest.fromPartial({ orderId: o.id, author: await ctx.actorName(), body }),
      );
      await ctx.audit({
        action: "Added internal note",
        recordType: "order",
        recordId: o.orderNumber || o.id,
        detail: body.length > 60 ? `${body.slice(0, 60)}…` : body,
      });
      return view(ctx, res.order ?? (await getOrder(ctx, o.id)));
    },
  );
};
