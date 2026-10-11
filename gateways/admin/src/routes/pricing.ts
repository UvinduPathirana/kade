import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  GetPricingConfigRequest,
  SaveSurchargeRuleRequest,
  SetSurchargeRuleEnabledRequest,
  SetWeatherSurchargeRequest,
  SetZoneOpenRequest,
  SurchargeDays,
  UpdateZoneFeesRequest,
  type SurchargeRule as ProtoSurchargeRule,
  type WeatherSurcharge as ProtoWeather,
} from "@kade/proto/kade/pricing/v1/pricing_service";
import { Type } from "typebox";
import { badRequest, notFound } from "../context.js";
import { formatRs, rs } from "../lib.js";
import { toZone } from "../mappers/partners.js";
import { fromRupees } from "../money.js";
import { Pricing, problems, ref, SURCHARGE_DAYS, SurchargeRule, WeatherSurcharge, Zone } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["pricing"];
type Days = SurchargeRule["days"];

const DAYS_FROM_PROTO: Record<number, Days> = {
  [SurchargeDays.SURCHARGE_DAYS_EVERY_DAY]: "Every day",
  [SurchargeDays.SURCHARGE_DAYS_MON_TO_FRI]: "Mon to Fri",
  [SurchargeDays.SURCHARGE_DAYS_FRI_TO_SUN]: "Fri to Sun",
  [SurchargeDays.SURCHARGE_DAYS_SAT_AND_SUN]: "Sat and Sun",
};
const DAYS_TO_PROTO: Record<Days, SurchargeDays> = {
  "Every day": SurchargeDays.SURCHARGE_DAYS_EVERY_DAY,
  "Mon to Fri": SurchargeDays.SURCHARGE_DAYS_MON_TO_FRI,
  "Fri to Sun": SurchargeDays.SURCHARGE_DAYS_FRI_TO_SUN,
  "Sat and Sun": SurchargeDays.SURCHARGE_DAYS_SAT_AND_SUN,
};

export const toSurcharge = (r: ProtoSurchargeRule): SurchargeRule => ({
  id: r.id,
  label: r.label,
  days: DAYS_FROM_PROTO[r.days] ?? "Every day",
  start: r.start,
  end: r.end,
  amount: rs(r.amount),
  enabled: r.enabled,
});
const toWeather = (w: ProtoWeather | undefined): WeatherSurcharge => ({
  enabled: w?.enabled ?? false,
  amount: rs(w?.amount),
});

const Time = Type.String({ pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" });

export const pricingRoutes =
  (opts: { invalidateZones: () => void }): FastifyPluginAsyncTypebox =>
  async (app) => {
    app.get(
      "/v1/pricing",
      {
        schema: {
          operationId: "getPricing",
          tags,
          security,
          summary: "Zones, surcharge rules and the rain surcharge in one read (pricing).",
          response: { 200: ref(Pricing), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const res = await ctx.rpc(
          ctx.up.pricing,
          "getPricingConfig",
          GetPricingConfigRequest.fromPartial({}),
        );
        const c = res.config;
        return {
          zones: (c?.zones ?? []).map(toZone),
          surcharges: (c?.surcharges ?? []).map(toSurcharge),
          weather: toWeather(c?.weather),
        };
      },
    );

    app.put(
      "/v1/zones/:id/open",
      {
        config: { permission: "pricing.edit" },
        schema: {
          operationId: "setZoneOpen",
          tags,
          security,
          summary: "Open or close a zone for delivery (pricing). Audited.",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ open: Type.Boolean() }),
          response: { 200: ref(Zone), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const res = await ctx.rpc(
          ctx.up.pricing,
          "setZoneOpen",
          SetZoneOpenRequest.fromPartial({ zoneId: req.params.id, open: req.body.open }),
        );
        if (!res.zone) throw notFound("Zone");
        opts.invalidateZones();
        const z = toZone(res.zone);
        await ctx.audit({
          action: req.body.open ? "Opened zone" : "Closed zone",
          recordType: "zone",
          recordId: z.id,
          detail: `${z.code}, ${z.name}`,
        });
        return z;
      },
    );

    app.put(
      "/v1/zones/:id/fees",
      {
        config: { permission: "pricing.edit" },
        schema: {
          operationId: "updateZoneFees",
          tags,
          security,
          summary: "Base, per-km and small-order fees of a zone, Rs 0–5,000 each (pricing). Audited.",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({
            baseFee: Type.Number(),
            perKm: Type.Number(),
            smallOrderFee: Type.Number(),
            smallOrderUnder: Type.Number(),
          }),
          response: { 200: ref(Zone), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const fees = req.body;
        for (const v of Object.values(fees))
          if (!Number.isInteger(v) || v < 0 || v > 5000)
            throw badRequest("FEE_OUT_OF_RANGE", "Fees must be between Rs 0 and Rs 5,000.");
        const res = await ctx.rpc(
          ctx.up.pricing,
          "updateZoneFees",
          UpdateZoneFeesRequest.fromPartial({
            zoneId: req.params.id,
            baseFee: fromRupees(fees.baseFee),
            perKm: fromRupees(fees.perKm),
            smallOrderFee: fromRupees(fees.smallOrderFee),
            smallOrderUnder: fromRupees(fees.smallOrderUnder),
          }),
        );
        if (!res.zone) throw notFound("Zone");
        opts.invalidateZones();
        const z = toZone(res.zone);
        await ctx.audit({
          action: "Changed delivery fees",
          recordType: "zone",
          recordId: z.id,
          detail: `${z.code}: base ${formatRs(fees.baseFee)}, ${formatRs(fees.perKm)} per km`,
        });
        return z;
      },
    );

    app.post(
      "/v1/surcharges",
      {
        config: { permission: "pricing.edit" },
        schema: {
          operationId: "saveSurcharge",
          tags,
          security,
          summary: "Create (no id) or update a time-window surcharge (pricing). Audited.",
          body: Type.Object({
            id: Type.Optional(Type.String()),
            label: Type.String({ maxLength: 60 }),
            days: Type.Enum(SURCHARGE_DAYS),
            start: Time,
            end: Time,
            amount: Type.Number(),
            enabled: Type.Boolean(),
          }),
          response: { 200: ref(SurchargeRule), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const rule = req.body;
        if (!rule.label.trim())
          throw badRequest(
            "LABEL_REQUIRED",
            "Give the rule a name staff will recognise, like “Dinner peak”.",
          );
        if (!Number.isInteger(rule.amount) || rule.amount <= 0 || rule.amount > 500)
          throw badRequest("SURCHARGE_OUT_OF_RANGE", "Surcharge must be between Rs 1 and Rs 500.");
        const res = await ctx.rpc(
          ctx.up.pricing,
          "saveSurchargeRule",
          SaveSurchargeRuleRequest.fromPartial({
            rule: {
              id: rule.id ?? "",
              label: rule.label.trim(),
              days: DAYS_TO_PROTO[rule.days],
              start: rule.start,
              end: rule.end,
              amount: fromRupees(rule.amount),
              enabled: rule.enabled,
            },
          }),
        );
        if (!res.rule) throw notFound("Rule");
        const saved = toSurcharge(res.rule);
        await ctx.audit({
          action: rule.id ? "Changed surcharge rule" : "Added surcharge rule",
          recordType: "zone",
          recordId: saved.id,
          detail: `${saved.label}: +${formatRs(saved.amount)}, ${saved.start} to ${saved.end}`,
        });
        return saved;
      },
    );

    app.put(
      "/v1/surcharges/:id/enabled",
      {
        config: { permission: "pricing.edit" },
        schema: {
          operationId: "setSurchargeEnabled",
          tags,
          security,
          summary: "Turn a surcharge rule on or off (pricing). Audited.",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ enabled: Type.Boolean() }),
          response: { 200: ref(SurchargeRule), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const res = await ctx.rpc(
          ctx.up.pricing,
          "setSurchargeRuleEnabled",
          SetSurchargeRuleEnabledRequest.fromPartial({ id: req.params.id, enabled: req.body.enabled }),
        );
        if (!res.rule) throw notFound("Rule");
        const r = toSurcharge(res.rule);
        await ctx.audit({
          action: `${r.enabled ? "Turned on" : "Turned off"} ${r.label.toLowerCase()} surcharge`,
          recordType: "zone",
          recordId: r.id,
        });
        return r;
      },
    );

    app.put(
      "/v1/weather",
      {
        config: { permission: "pricing.edit" },
        schema: {
          operationId: "setWeather",
          tags,
          security,
          summary: "Heavy rain surcharge on/off and its amount, Rs 1–500 (pricing). Audited.",
          body: Type.Object({ enabled: Type.Boolean(), amount: Type.Number() }),
          response: { 200: ref(WeatherSurcharge), ...problems(400, 401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const next = req.body;
        if (!Number.isInteger(next.amount) || next.amount <= 0 || next.amount > 500)
          throw badRequest("SURCHARGE_OUT_OF_RANGE", "Rain surcharge must be between Rs 1 and Rs 500.");
        const res = await ctx.rpc(
          ctx.up.pricing,
          "setWeatherSurcharge",
          SetWeatherSurchargeRequest.fromPartial({
            weather: { enabled: next.enabled, amount: fromRupees(next.amount) },
          }),
        );
        await ctx.audit({
          action: next.enabled
            ? `Turned on heavy rain surcharge, +${formatRs(next.amount)}`
            : "Turned off heavy rain surcharge",
          recordType: "zone",
          recordId: "weather",
        });
        return toWeather(res.weather ?? { enabled: next.enabled, amount: fromRupees(next.amount) });
      },
    );
  };
