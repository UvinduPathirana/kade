import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { DateRange } from "@kade/proto/kade/common/v1/commerce";
import {
  ApprovePayoutBatchRequest,
  GetPayoutBatchRequest,
  ListCashRecordsRequest,
  ListPayoutBatchesRequest,
  ListRefundsRequest,
  ListRiderSettlementsRequest,
  PayoutBatchStatus,
  RecordCashDepositRequest,
  SettlementStatus,
  SettleRiderRequest,
  type CashRecord,
  type PayoutBatch,
  type RiderSettlement,
} from "@kade/proto/kade/ledger/v1/ledger_service";
import type { OutletAdminView } from "@kade/proto/kade/merchant/v1/merchant_service";
import { GetCustomerRequest } from "@kade/proto/kade/profile/v1/profile_service";
import { Type } from "typebox";
import { badRequest, notFound, type Ctx } from "../context.js";
import { personId, personUuid, restaurantNumber } from "../ids.js";
import { allPages, formatRs, mapLimit, PAGE, rs, soft } from "../lib.js";
import { fromRupees } from "../money.js";
import { toRefundFromLedger } from "./customers.js";
import { CashView, listOf, PayoutBatchView, problems, ref, RefundView, SettlementView } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["finance"];
const FINANCE_READ = ["finance.payouts", "finance.cash", "orders.refundAny"];

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "28 Sep to 4 Oct" from an ISO date range. */
export const weekLabel = (p: DateRange | undefined) =>
  p?.fromDate && p.toDate
    ? `${dayMonth.format(new Date(`${p.fromDate}T00:00:00Z`))} to ${dayMonth.format(new Date(`${p.toDate}T00:00:00Z`))}`
    : "";

const BATCH_STATUS: Record<number, PayoutBatchView["status"]> = {
  [PayoutBatchStatus.PAYOUT_BATCH_STATUS_DRAFT]: "draft",
  [PayoutBatchStatus.PAYOUT_BATCH_STATUS_APPROVED]: "approved",
  [PayoutBatchStatus.PAYOUT_BATCH_STATUS_PAID]: "paid",
};

export function toPayoutBatchView(b: PayoutBatch, outlets: OutletAdminView[]): PayoutBatchView {
  const lines = b.lines.map((l) => {
    const o = outlets.find((x) => x.outlet?.id === l.outletId)?.outlet;
    return {
      restaurantId: restaurantNumber(l.outletId),
      orders: l.orders,
      gross: rs(l.gross),
      commission: rs(l.commission),
      adjustments: rs(l.adjustments),
      net: rs(l.net),
      restaurantName: l.outletName || o?.name || "",
      commissionRate: o ? o.commissionBps / 100 : 0,
      bank: o?.bank?.bank ? `${o.bank.bank} ending ${o.bank.accountLast4}` : "",
    };
  });
  const sum = (k: "gross" | "commission" | "adjustments" | "net" | "orders") =>
    lines.reduce((s, l) => s + l[k], 0);
  return {
    id: b.id,
    week: weekLabel(b.period),
    payDate: b.payDate,
    status: BATCH_STATUS[b.status] ?? "draft",
    approvedBy: b.approvedBy || undefined,
    lines,
    totals: {
      gross: sum("gross"),
      commission: sum("commission"),
      adjustments: sum("adjustments"),
      net: lines.length ? sum("net") : rs(b.total),
      orders: sum("orders"),
    },
  };
}

export const toSettlementView = (s: RiderSettlement): SettlementView => ({
  riderId: personId(s.riderId),
  riderName: s.riderName,
  week: weekLabel(s.period),
  trips: s.trips,
  earnings: rs(s.earnings),
  cashHeld: rs(s.cashHeld),
  net: s.net ? rs(s.net) : rs(s.earnings) - rs(s.cashHeld),
  status: s.status === SettlementStatus.SETTLEMENT_STATUS_SETTLED ? "settled" : "open",
});

export function toCashView(c: CashRecord): CashView {
  const deposited = c.deposited ? rs(c.deposited) : null;
  const collected = rs(c.collected);
  const difference = deposited === null ? null : collected - deposited;
  return {
    id: c.id,
    riderId: personId(c.riderId),
    riderName: c.riderName,
    date: c.date,
    collected,
    deposited,
    bankRef: c.bankRef || undefined,
    difference,
    state:
      difference === null ? "awaiting" : difference === 0 ? "matched" : difference > 0 ? "short" : "over",
  };
}

// Customer display names for the refunds ledger; profile has no batch read, so remember them.
const customerNames = new Map<string, string>();
async function namesFor(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  const missing = [...new Set(ids)].filter((id) => id && !customerNames.has(id));
  await mapLimit(missing.slice(0, 100), 6, async (id) => {
    const res = await soft(
      ctx.log,
      "customer name",
      ctx.rpc(ctx.up.customers, "getCustomer", GetCustomerRequest.fromPartial({ customerId: id })),
      undefined,
    );
    if (res?.customer) customerNames.set(id, res.customer.name);
  });
  return customerNames;
}

async function listSettlements(ctx: Ctx): Promise<RiderSettlement[]> {
  return allPages(async (pageToken) => {
    const res = await ctx.rpc(
      ctx.up.riderFinance,
      "listRiderSettlements",
      ListRiderSettlementsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
    );
    return { items: res.settlements, next: res.page?.nextPageToken ?? "" };
  });
}

export const financeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/v1/finance/payouts",
    {
      config: { permission: FINANCE_READ },
      schema: {
        operationId: "listPayoutBatches",
        tags,
        security,
        summary: "Weekly restaurant payout batches with a line per restaurant (ledger + merchant).",
        response: { 200: listOf(PayoutBatchView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const [batches, outlets] = await Promise.all([
        allPages(async (pageToken) => {
          const res = await ctx.rpc(
            ctx.up.payouts,
            "listPayoutBatches",
            ListPayoutBatchesRequest.fromPartial({ page: { pageSize: 20, pageToken } }),
          );
          return { items: res.batches, next: res.page?.nextPageToken ?? "" };
        }, 2),
        soft(ctx.log, "outlets", ctx.outlets(), []),
      ]);
      const full = await mapLimit(batches.slice(0, 12), 4, async (b) =>
        b.lines.length
          ? b
          : ((
              await ctx.rpc(
                ctx.up.payouts,
                "getPayoutBatch",
                GetPayoutBatchRequest.fromPartial({ batchId: b.id }),
              )
            ).batch ?? b),
      );
      return full.map((b) => toPayoutBatchView(b, outlets));
    },
  );

  app.post(
    "/v1/finance/payouts/:id/approve",
    {
      config: { permission: "finance.payouts" },
      schema: {
        operationId: "approvePayoutBatch",
        tags,
        security,
        summary: "Draft → approved (ledger). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        response: { 200: ref(PayoutBatchView), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.payouts,
        "approvePayoutBatch",
        ApprovePayoutBatchRequest.fromPartial({
          batchId: req.params.id,
          actor: { userId: ctx.identity.userId, roles: ctx.identity.roles },
          approverName: await ctx.actorName(),
        }),
      );
      if (!res.batch) throw notFound("Payout batch");
      const v = toPayoutBatchView(res.batch, await soft(ctx.log, "outlets", ctx.outlets(), []));
      await ctx.audit({
        action: `Approved payout batch, ${formatRs(v.totals.net)}`,
        recordType: "payout",
        recordId: v.id,
        detail: `${v.lines.length || res.batch.outlets} restaurants, week of ${v.week}`,
      });
      return v;
    },
  );

  app.get(
    "/v1/finance/settlements",
    {
      config: { permission: FINANCE_READ },
      schema: {
        operationId: "listRiderSettlements",
        tags,
        security,
        summary: "Weekly rider settlements: earnings against cash held (ledger).",
        response: { 200: listOf(SettlementView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => (await listSettlements(req.ctx)).map(toSettlementView),
  );

  app.post(
    "/v1/finance/settlements/:riderId/settle",
    {
      config: { permission: "finance.cash" },
      schema: {
        operationId: "settleRider",
        tags,
        security,
        summary: "Net the rider's open week and close it (ledger). Audited.",
        params: Type.Object({ riderId: Type.String({ minLength: 1 }) }),
        response: { 200: ref(SettlementView), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const riderUuid = personUuid(req.params.riderId);
      const open = (await listSettlements(ctx)).find(
        (s) => s.riderId === riderUuid && s.status !== SettlementStatus.SETTLEMENT_STATUS_SETTLED,
      );
      if (!open) throw notFound("Open settlement");
      const res = await ctx.rpc(
        ctx.up.riderFinance,
        "settleRider",
        SettleRiderRequest.fromPartial({
          riderId: riderUuid,
          period: open.period,
          actor: { userId: ctx.identity.userId, roles: ctx.identity.roles },
          idempotencyKey: `settle:${riderUuid}:${open.period?.fromDate ?? ""}`,
        }),
      );
      const s = toSettlementView(
        res.settlement ?? { ...open, status: SettlementStatus.SETTLEMENT_STATUS_SETTLED },
      );
      await ctx.audit({
        action: s.net >= 0 ? `Paid rider ${formatRs(s.net)}` : `Received ${formatRs(-s.net)} from rider`,
        recordType: "rider",
        recordId: s.riderId,
        detail: `Settlement for ${s.week}`,
      });
      return s;
    },
  );

  app.get(
    "/v1/finance/cash",
    {
      config: { permission: FINANCE_READ },
      schema: {
        operationId: "listCashRecords",
        tags,
        security,
        summary: "Daily cash collected per rider against bank deposits, newest first (ledger).",
        response: { 200: listOf(CashView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const records = await allPages(async (pageToken) => {
        const res = await ctx.rpc(
          ctx.up.riderFinance,
          "listCashRecords",
          ListCashRecordsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
        );
        return { items: res.records, next: res.page?.nextPageToken ?? "" };
      }, 5);
      return records.map(toCashView).sort((a, b) => b.date.localeCompare(a.date));
    },
  );

  app.post(
    "/v1/finance/cash/:id/deposit",
    {
      config: { permission: "finance.cash" },
      schema: {
        operationId: "recordDeposit",
        tags,
        security,
        summary: "Match a bank deposit slip against a rider's cash (ledger). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
        body: Type.Object({ amount: Type.Integer({ minimum: 0 }), bankRef: Type.String({ maxLength: 64 }) }),
        response: { 200: ref(CashView), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const bankRef = req.body.bankRef.trim().toUpperCase();
      if (!bankRef) throw badRequest("BANK_REF_REQUIRED", "Enter the bank reference from the deposit slip.");
      const res = await ctx.rpc(
        ctx.up.riderFinance,
        "recordCashDeposit",
        RecordCashDepositRequest.fromPartial({
          cashRecordId: req.params.id,
          amount: fromRupees(req.body.amount),
          bankRef,
          actor: { userId: ctx.identity.userId, roles: ctx.identity.roles },
          idempotencyKey: req.headers["idempotency-key"] || randomUUID(),
        }),
      );
      if (!res.record) throw notFound("Cash record");
      const c = toCashView(res.record);
      await ctx.audit({
        action: `Recorded cash deposit ${formatRs(req.body.amount)}`,
        recordType: "rider",
        recordId: c.riderId,
        detail: bankRef,
      });
      return c;
    },
  );

  app.get(
    "/v1/finance/refunds",
    {
      config: { permission: FINANCE_READ },
      schema: {
        operationId: "listRefunds",
        tags,
        security,
        summary: "Refunds over the last 90 days, newest first (ledger), with customer names (profile).",
        response: { 200: listOf(RefundView), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const refunds = await allPages(async (pageToken) => {
        const res = await ctx.rpc(
          ctx.up.ledger,
          "listRefunds",
          ListRefundsRequest.fromPartial({
            from: new Date(Date.now() - 90 * 86_400_000),
            page: { pageSize: PAGE, pageToken },
          }),
        );
        return { items: res.refunds, next: res.page?.nextPageToken ?? "" };
      }, 10);
      const names = await namesFor(
        ctx,
        refunds.map((r) => r.customerId),
      );
      return refunds
        .map((r) => ({ ...toRefundFromLedger(r), customerName: names.get(r.customerId) ?? "Unknown" }))
        .sort((a, b) => b.at - a.at);
    },
  );
};
