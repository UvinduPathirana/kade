import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  CreateVoucherRequest,
  FundedBy,
  ListVouchersRequest,
  SetVoucherStatusRequest,
  VoucherStatus,
  VoucherType,
  type Voucher as ProtoVoucher,
} from "@kade/proto/kade/promotion/v1/promotion_service";
import { Type } from "typebox";
import { badRequest, notFound } from "../context.js";
import { restaurantNumber, restaurantUuid } from "../ids.js";
import { allPages, formatRs, PAGE, rs } from "../lib.js";
import { fromRupees } from "../money.js";
import { listOf, NewVoucher, problems, ref, Voucher, VOUCHER_STATUSES } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["promotions"];

const TYPE_FROM_PROTO: Record<number, Voucher["type"]> = {
  [VoucherType.VOUCHER_TYPE_FIXED]: "fixed",
  [VoucherType.VOUCHER_TYPE_PERCENT]: "percent",
  [VoucherType.VOUCHER_TYPE_FREE_DELIVERY]: "freeDelivery",
};
const TYPE_TO_PROTO: Record<Voucher["type"], VoucherType> = {
  fixed: VoucherType.VOUCHER_TYPE_FIXED,
  percent: VoucherType.VOUCHER_TYPE_PERCENT,
  freeDelivery: VoucherType.VOUCHER_TYPE_FREE_DELIVERY,
};
const STATUS_FROM_PROTO: Record<number, Voucher["status"]> = {
  [VoucherStatus.VOUCHER_STATUS_ACTIVE]: "active",
  [VoucherStatus.VOUCHER_STATUS_SCHEDULED]: "scheduled",
  [VoucherStatus.VOUCHER_STATUS_PAUSED]: "paused",
  [VoucherStatus.VOUCHER_STATUS_ENDED]: "ended",
};
const STATUS_TO_PROTO: Record<Voucher["status"], VoucherStatus> = {
  active: VoucherStatus.VOUCHER_STATUS_ACTIVE,
  scheduled: VoucherStatus.VOUCHER_STATUS_SCHEDULED,
  paused: VoucherStatus.VOUCHER_STATUS_PAUSED,
  ended: VoucherStatus.VOUCHER_STATUS_ENDED,
};

export function toVoucher(v: ProtoVoucher): Voucher {
  const type = TYPE_FROM_PROTO[v.type] ?? "fixed";
  return {
    code: v.code,
    description: v.description || v.label,
    type,
    value: type === "fixed" ? rs(v.amount) : type === "percent" ? v.percent : 0,
    maxDiscount: type === "percent" && rs(v.maxDiscount) > 0 ? rs(v.maxDiscount) : undefined,
    minOrder: rs(v.minOrder),
    restaurantIds: v.restaurantIds.map(restaurantNumber),
    newCustomersOnly: v.newCustomersOnly,
    startsOn: v.startsOn,
    endsOn: v.endsOn,
    uses: v.uses,
    limit: v.useLimit,
    budget: rs(v.budget),
    spent: rs(v.spent),
    status: STATUS_FROM_PROTO[v.status] ?? "active",
  };
}

export const promotionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/v1/vouchers",
    {
      schema: {
        operationId: "listVouchers",
        tags,
        security,
        summary: "Every voucher with uses, budget and spend (promotion).",
        response: { 200: listOf(Voucher), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const vouchers = await allPages(async (pageToken) => {
        const res = await ctx.rpc(
          ctx.up.vouchers,
          "listVouchers",
          ListVouchersRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
        );
        return { items: res.vouchers, next: res.page?.nextPageToken ?? "" };
      }, 5);
      return vouchers.map(toVoucher);
    },
  );

  app.post(
    "/v1/vouchers",
    {
      config: { permission: "promos.edit" },
      schema: {
        operationId: "createVoucher",
        tags,
        security,
        summary: "Create a Kadé-funded voucher; codes are 4–16 letters and numbers (promotion). Audited.",
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
        body: ref(NewVoucher),
        response: { 201: ref(Voucher), ...problems(400, 401, 403, 409, 503, 504) },
      },
    },
    async (req, reply) => {
      const ctx = req.ctx;
      const v = req.body;
      const code = v.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,16}$/.test(code))
        throw badRequest("VOUCHER_CODE_INVALID", "Codes are 4 to 16 letters and numbers, with no spaces.");
      const res = await ctx.rpc(
        ctx.up.vouchers,
        "createVoucher",
        CreateVoucherRequest.fromPartial({
          voucher: {
            code,
            description: v.description,
            type: TYPE_TO_PROTO[v.type],
            amount: v.type === "fixed" ? fromRupees(Math.round(v.value)) : undefined,
            percent: v.type === "percent" ? Math.round(v.value) : 0,
            maxDiscount: v.maxDiscount ? fromRupees(Math.round(v.maxDiscount)) : undefined,
            minOrder: fromRupees(v.minOrder),
            restaurantIds: v.restaurantIds.map(restaurantUuid),
            newCustomersOnly: v.newCustomersOnly,
            startsOn: v.startsOn,
            endsOn: v.endsOn,
            useLimit: v.limit,
            budget: fromRupees(v.budget),
            fundedBy: FundedBy.FUNDED_BY_KADE,
          },
          idempotencyKey: req.headers["idempotency-key"] || randomUUID(),
        }),
      );
      if (!res.voucher) throw notFound("Voucher");
      await ctx.audit({
        action: "Created voucher",
        recordType: "voucher",
        recordId: code,
        detail: `${v.description}. Budget ${formatRs(v.budget)}`,
      });
      return reply.code(201).send(toVoucher(res.voucher));
    },
  );

  app.put(
    "/v1/vouchers/:code/status",
    {
      config: { permission: "promos.edit" },
      schema: {
        operationId: "setVoucherStatus",
        tags,
        security,
        summary: "Pause, resume or end a voucher; ended ones can't restart (promotion). Audited.",
        params: Type.Object({ code: Type.String({ minLength: 1, maxLength: 16 }) }),
        body: Type.Object({ status: Type.Enum(VOUCHER_STATUSES) }),
        response: { 200: ref(Voucher), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { status } = req.body;
      const res = await ctx.rpc(
        ctx.up.vouchers,
        "setVoucherStatus",
        SetVoucherStatusRequest.fromPartial({ code: req.params.code, status: STATUS_TO_PROTO[status] }),
      );
      if (!res.voucher) throw notFound("Voucher");
      const verb = { active: "Resumed", paused: "Paused", ended: "Ended", scheduled: "Scheduled" }[status];
      await ctx.audit({ action: `${verb} voucher`, recordType: "voucher", recordId: req.params.code });
      return toVoucher(res.voucher);
    },
  );
};
