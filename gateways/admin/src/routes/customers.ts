import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { ListRefundsRequest, type RefundRecord } from "@kade/proto/kade/ledger/v1/ledger_service";
import { ListOrdersRequest } from "@kade/proto/kade/order/v1/order_service";
import {
  ChangeCreditRequest,
  CreditReason,
  FraudFlagKind,
  FraudFlagStatus,
  GetCustomerDetailRequest,
  ListCustomersRequest,
  ResolveFraudFlagRequest,
  SetCustomerBlockedRequest,
  type CustomerSummary,
  type FraudFlag as ProtoFraudFlag,
  type GetCustomerDetailResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { Type } from "typebox";
import { badRequest, notFound, type Ctx } from "../context.js";
import { personId, personUuid } from "../ids.js";
import { allPages, formatRs, isoDate, ms, msOpt, nonEmpty, PAGE, rs, soft } from "../lib.js";
import { isHidden, ORDER_STATUS, orderRef, refundMethod } from "../mappers/orders.js";
import { fromRupees } from "../money.js";
import { CustomerDetail, CustomerView, listOf, problems, ref, type Refund } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["customers"];
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
type Flag = CustomerView["flags"][number];

const FLAG_KIND: Record<number, Flag["kind"]> = {
  [FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS]: "refunds",
  [FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS]: "cancellations",
  [FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES]: "paymentFailures",
};
const FLAG_STATUS: Record<number, Flag["status"]> = {
  [FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN]: "open",
  [FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED]: "cleared",
  [FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED]: "actioned",
};

const toFlag = (f: ProtoFraudFlag): Flag => ({
  id: f.id,
  kind: FLAG_KIND[f.kind] ?? "refunds",
  detail: f.detail,
  raisedAt: ms(f.raisedAt),
  status: FLAG_STATUS[f.status] ?? "open",
  resolution: nonEmpty(f.resolution),
});

export const toRefundFromLedger = (r: RefundRecord): Refund => ({
  id: r.id,
  at: ms(r.at),
  orderId: r.orderNumber || r.orderId,
  customerId: personId(r.customerId),
  amount: rs(r.amount),
  method: refundMethod(r.method),
  reason: r.reason,
  by: r.by || "Kadé",
});

/** Refunds over the last 90 days from ledger (empty when ledger is unreachable). */
async function recentRefunds(ctx: Ctx): Promise<RefundRecord[]> {
  return soft(
    ctx.log,
    "ledger refunds",
    allPages(async (pageToken) => {
      const res = await ctx.rpc(
        ctx.up.ledger,
        "listRefunds",
        ListRefundsRequest.fromPartial({
          from: new Date(Date.now() - 90 * 86_400_000),
          page: { pageSize: PAGE, pageToken },
        }),
      );
      return { items: res.refunds, next: res.page?.nextPageToken ?? "" };
    }, 10),
    [],
  );
}

export function summaryView(s: CustomerSummary, refunds: RefundRecord[]): CustomerView {
  const c = s.customer!;
  const theirs = refunds.filter((r) => r.customerId === c.id);
  return {
    id: personId(c.id),
    name: c.name,
    phone: c.phone,
    email: c.email,
    area: c.area,
    joinedOn: isoDate(c.joinedAt),
    ordersCount: s.stats?.ordersCount ?? 0,
    spend: rs(s.stats?.spend),
    credit: rs(s.creditBalance),
    blocked: c.blocked,
    blockReason: c.blocked ? nonEmpty(c.blockReason) : undefined,
    flags: [],
    creditHistory: [],
    refundCount: theirs.length,
    refundTotal: theirs.reduce((sum, r) => sum + rs(r.amount), 0),
    cancelCount: 0,
    openFlags: s.openFlags,
    lastOrderAt: msOpt(s.stats?.lastOrderAt),
  };
}

function detailView(
  d: GetCustomerDetailResponse,
  refunds: RefundRecord[],
  cancelCount: number,
): CustomerView {
  const c = d.customer!;
  const flags = d.flags.map(toFlag);
  const theirs = refunds.filter((r) => r.customerId === c.id);
  return {
    id: personId(c.id),
    name: c.name,
    phone: c.phone,
    email: c.email,
    area: c.area,
    joinedOn: isoDate(c.joinedAt),
    ordersCount: d.stats?.ordersCount ?? 0,
    spend: rs(d.stats?.spend),
    credit: rs(d.credit?.balance),
    blocked: c.blocked,
    blockReason: c.blocked ? nonEmpty(c.blockReason) : undefined,
    flags,
    creditHistory: (d.credit?.history ?? []).map((h) => ({
      id: h.id,
      at: ms(h.at),
      amount: rs(h.amount),
      reason: h.label,
      by: h.by || "Kadé",
    })),
    refundCount: theirs.length,
    refundTotal: theirs.reduce((sum, r) => sum + rs(r.amount), 0),
    cancelCount,
    openFlags: flags.filter((f) => f.status === "open").length,
    lastOrderAt: msOpt(d.stats?.lastOrderAt),
  };
}

async function getDetail(ctx: Ctx, id: string) {
  const d = await ctx.rpc(
    ctx.up.customers,
    "getCustomerDetail",
    GetCustomerDetailRequest.fromPartial({ customerId: personUuid(id) }),
  );
  if (!d.customer) throw notFound("Customer");
  return d;
}

async function customerOrders(ctx: Ctx, customerUuid: string) {
  const res = await soft(
    ctx.log,
    "customer orders",
    ctx.rpc(
      ctx.up.order,
      "listOrders",
      ListOrdersRequest.fromPartial({ customerId: customerUuid, page: { pageSize: PAGE } }),
    ),
    undefined,
  );
  return (res?.orders ?? []).filter((o) => !isHidden(o));
}

async function viewAfterChange(ctx: Ctx, id: string): Promise<CustomerView> {
  const d = await getDetail(ctx, id);
  const [refunds, orders] = await Promise.all([recentRefunds(ctx), customerOrders(ctx, d.customer!.id)]);
  return detailView(d, refunds, orders.filter((o) => ORDER_STATUS[o.status] === "cancelled").length);
}

export const customerRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/v1/customers",
    {
      config: { permission: "orders.view" },
      schema: {
        operationId: "listCustomers",
        tags,
        security,
        summary: "Customers with order stats, credit, refunds (ledger) and open fraud flags (profile).",
        response: { 200: listOf(CustomerView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const [customers, refunds] = await Promise.all([
        allPages(async (pageToken) => {
          const res = await ctx.rpc(
            ctx.up.customers,
            "listCustomers",
            ListCustomersRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
          );
          return { items: res.customers, next: res.page?.nextPageToken ?? "" };
        }, 10),
        recentRefunds(ctx),
      ]);
      return customers.filter((s) => s.customer).map((s) => summaryView(s, refunds));
    },
  );

  app.get(
    "/v1/customers/:id",
    {
      config: { permission: "orders.view" },
      schema: {
        operationId: "getCustomer",
        tags,
        security,
        summary: "One customer with flags, credit history, recent orders (order) and refunds (ledger).",
        params: IdParams,
        response: { 200: ref(CustomerDetail), ...problems(401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const d = await getDetail(ctx, req.params.id);
      const [refunds, orders] = await Promise.all([recentRefunds(ctx), customerOrders(ctx, d.customer!.id)]);
      const view = detailView(
        d,
        refunds,
        orders.filter((o) => ORDER_STATUS[o.status] === "cancelled").length,
      );
      return {
        ...view,
        orders: orders
          .sort((a, b) => ms(b.placedAt) - ms(a.placedAt))
          .slice(0, 12)
          .map((o) => ({
            id: orderRef(o),
            placedAt: ms(o.placedAt ?? o.createdAt),
            restaurantName: o.restaurant?.name ?? "",
            total: rs(o.totals?.total),
            status: ORDER_STATUS[o.status],
            refunded: rs(o.refunded),
          })),
        refunds: refunds.filter((r) => r.customerId === d.customer!.id).map(toRefundFromLedger),
      };
    },
  );

  app.post(
    "/v1/customers/:id/credit",
    {
      config: { permission: "customers.credit" },
      schema: {
        operationId: "issueCredit",
        tags,
        security,
        summary: "Goodwill Kadé credit, Rs 1–5,000 (admins up to Rs 50,000) (profile). Audited.",
        params: IdParams,
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
        body: Type.Object({ amount: Type.Number(), reason: Type.String({ minLength: 1, maxLength: 500 }) }),
        response: { 200: ref(CustomerView), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { amount, reason } = req.body;
      const cap = ctx.identity.roles.includes("admin") ? 50_000 : 5_000;
      if (!Number.isInteger(amount) || amount <= 0 || amount > cap)
        throw badRequest(
          "CREDIT_OUT_OF_RANGE",
          cap === 5_000
            ? "Credit must be between Rs 1 and Rs 5,000. Ask an admin for more."
            : `Credit must be between Rs 1 and ${formatRs(cap)}.`,
        );
      await ctx.rpc(
        ctx.up.credit,
        "changeCredit",
        ChangeCreditRequest.fromPartial({
          customerId: personUuid(req.params.id),
          amount: fromRupees(amount),
          reason: CreditReason.CREDIT_REASON_GOODWILL,
          label: reason,
          by: await ctx.actorName(),
          idempotencyKey: req.headers["idempotency-key"] || randomUUID(),
        }),
      );
      await ctx.audit({
        action: `Issued ${formatRs(amount)} Kadé credit`,
        recordType: "customer",
        recordId: req.params.id,
        detail: reason,
      });
      return viewAfterChange(ctx, req.params.id);
    },
  );

  app.post(
    "/v1/customers/:id/flags/:flagId",
    {
      config: { permission: "customers.block" },
      schema: {
        operationId: "resolveFlag",
        tags,
        security,
        summary: "Clear or action a fraud flag (profile). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }), flagId: Type.String({ minLength: 1 }) }),
        body: Type.Object({
          outcome: Type.Union([Type.Literal("cleared"), Type.Literal("actioned")]),
          note: Type.String({ maxLength: 500 }),
        }),
        response: { 200: ref(CustomerView), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { outcome, note } = req.body;
      const name = await ctx.actorName();
      const short = name.split(" ")[0] ?? name;
      await ctx.rpc(
        ctx.up.customers,
        "resolveFraudFlag",
        ResolveFraudFlagRequest.fromPartial({
          customerId: personUuid(req.params.id),
          flagId: req.params.flagId,
          status:
            outcome === "cleared"
              ? FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED
              : FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED,
          resolution: `${note || (outcome === "cleared" ? "Looked genuine" : "Action taken")}. ${
            outcome === "cleared" ? "Cleared" : "Actioned"
          } by ${short}.`,
        }),
      );
      await ctx.audit({
        action: outcome === "cleared" ? "Cleared fraud flag" : "Actioned fraud flag",
        recordType: "customer",
        recordId: req.params.id,
        detail: note,
      });
      return viewAfterChange(ctx, req.params.id);
    },
  );

  app.put(
    "/v1/customers/:id/block",
    {
      config: { permission: "customers.block" },
      schema: {
        operationId: "setBlocked",
        tags,
        security,
        summary: "Block or unblock a customer with a reason (profile). Audited.",
        params: IdParams,
        body: Type.Object({ blocked: Type.Boolean(), reason: Type.String({ maxLength: 500 }) }),
        response: { 200: ref(CustomerView), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { blocked, reason } = req.body;
      await ctx.rpc(
        ctx.up.customers,
        "setCustomerBlocked",
        SetCustomerBlockedRequest.fromPartial({ customerId: personUuid(req.params.id), blocked, reason }),
      );
      await ctx.audit({
        action: blocked ? "Blocked customer" : "Unblocked customer",
        recordType: "customer",
        recordId: req.params.id,
        detail: reason,
      });
      return viewAfterChange(ctx, req.params.id);
    },
  );
};
