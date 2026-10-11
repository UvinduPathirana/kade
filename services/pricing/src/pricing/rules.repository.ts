import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { pricingSettings, surchargeRules, zones } from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database, type HasDeadline, type Queryable, type Tx } from "../platform/db/database.js";
import { notFound } from "../platform/grpc/errors.js";
import type { Days, RuleSet, SurchargeRuleModel, WeatherRule, ZoneRule } from "./rules.js";

type ZoneRow = typeof zones.$inferSelect;
type RuleRow = typeof surchargeRules.$inferSelect;

export const toZone = (r: ZoneRow): ZoneRule => ({
  id: r.id,
  code: r.code,
  name: r.name,
  open: r.open,
  baseFee: r.baseFeeMinor,
  perKm: r.perKmMinor,
  smallOrderFee: r.smallOrderFeeMinor,
  smallOrderUnder: r.smallOrderUnderMinor,
  ridersNeeded: r.ridersNeeded,
  center: { lat: r.centerLat, lng: r.centerLng },
  radiusKm: r.radiusKm,
  position: r.position,
});

export const toRule = (r: RuleRow): SurchargeRuleModel => ({
  id: r.id,
  label: r.label,
  days: r.days as Days,
  start: r.startTime,
  end: r.endTime,
  amount: r.amountMinor,
  enabled: r.enabled,
});

export interface ZoneFees {
  baseFee: number;
  perKm: number;
  smallOrderFee: number;
  smallOrderUnder: number;
}

/**
 * Reads and writes the rule tables. Reads go through a short cache (RULES_CACHE_MS) because every
 * quote and every restaurant listing needs the whole rule set; every write bumps rules_version in
 * the same transaction and drops the cache.
 */
@Injectable()
export class RulesRepository {
  private cached: { rules: RuleSet; until: number } | undefined;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async rules(): Promise<RuleSet> {
    const now = Date.now();
    if (this.cached && this.cached.until > now) return this.cached.rules;
    const rules = await this.load(this.database.db);
    this.cached = { rules, until: now + this.config.RULES_CACHE_MS };
    return rules;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  async load(db: Queryable): Promise<RuleSet> {
    const [zoneRows, ruleRows, settings] = await Promise.all([
      db.select().from(zones).orderBy(asc(zones.position), asc(zones.id)),
      db.select().from(surchargeRules).orderBy(asc(surchargeRules.createdAt), asc(surchargeRules.id)),
      db.select().from(pricingSettings).where(eq(pricingSettings.id, 1)),
    ]);
    const s = settings[0];
    if (!s) throw new Error("pricing_settings row missing (seed migration not applied?)");
    return {
      zones: zoneRows.map(toZone),
      surcharges: ruleRows.map(toRule),
      weather: { enabled: s.weatherEnabled, amount: s.weatherAmountMinor },
      plusFreeDeliveryFrom: s.plusFreeDeliveryFromMinor,
      rulesVersion: s.rulesVersion,
    };
  }

  /** Runs a rule change and bumps rules_version in the same transaction. */
  private async change<T>(ctx: HasDeadline, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const result = await this.database.transaction(ctx, async (tx) => {
      const value = await fn(tx);
      await tx
        .update(pricingSettings)
        .set({ rulesVersion: sql`${pricingSettings.rulesVersion} + 1`, updatedAt: new Date() })
        .where(eq(pricingSettings.id, 1));
      return value;
    });
    this.invalidate();
    return result;
  }

  setZoneOpen(ctx: HasDeadline, id: string, open: boolean): Promise<ZoneRule> {
    return this.change(ctx, async (tx) => {
      const [row] = await tx
        .update(zones)
        .set({ open, updatedAt: new Date() })
        .where(eq(zones.id, id))
        .returning();
      if (!row) throw zoneNotFound(id);
      return toZone(row);
    });
  }

  updateZoneFees(ctx: HasDeadline, id: string, fees: ZoneFees): Promise<ZoneRule> {
    return this.change(ctx, async (tx) => {
      const [row] = await tx
        .update(zones)
        .set({
          baseFeeMinor: fees.baseFee,
          perKmMinor: fees.perKm,
          smallOrderFeeMinor: fees.smallOrderFee,
          smallOrderUnderMinor: fees.smallOrderUnder,
          updatedAt: new Date(),
        })
        .where(eq(zones.id, id))
        .returning();
      if (!row) throw zoneNotFound(id);
      return toZone(row);
    });
  }

  saveSurchargeRule(
    ctx: HasDeadline,
    rule: Omit<SurchargeRuleModel, "id"> & { id?: string },
  ): Promise<SurchargeRuleModel> {
    return this.change(ctx, async (tx) => {
      const values = {
        label: rule.label,
        days: rule.days,
        startTime: rule.start,
        endTime: rule.end,
        amountMinor: rule.amount,
        enabled: rule.enabled,
        updatedAt: new Date(),
      };
      if (!rule.id) {
        const [row] = await tx
          .insert(surchargeRules)
          .values({ id: uuidv7(), ...values })
          .returning();
        return toRule(row!);
      }
      const [row] = await tx
        .update(surchargeRules)
        .set(values)
        .where(eq(surchargeRules.id, rule.id))
        .returning();
      if (!row) throw ruleNotFound(rule.id);
      return toRule(row);
    });
  }

  setSurchargeRuleEnabled(ctx: HasDeadline, id: string, enabled: boolean): Promise<SurchargeRuleModel> {
    return this.change(ctx, async (tx) => {
      const [row] = await tx
        .update(surchargeRules)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(surchargeRules.id, id))
        .returning();
      if (!row) throw ruleNotFound(id);
      return toRule(row);
    });
  }

  setWeather(ctx: HasDeadline, weather: WeatherRule): Promise<WeatherRule> {
    return this.change(ctx, async (tx) => {
      const [row] = await tx
        .update(pricingSettings)
        .set({ weatherEnabled: weather.enabled, weatherAmountMinor: weather.amount })
        .where(eq(pricingSettings.id, 1))
        .returning();
      return { enabled: row!.weatherEnabled, amount: row!.weatherAmountMinor };
    });
  }
}

const zoneNotFound = (id: string) => notFound("ZONE_NOT_FOUND", "That zone doesn't exist.", { zone_id: id });
const ruleNotFound = (id: string) =>
  notFound("SURCHARGE_RULE_NOT_FOUND", "That surcharge rule doesn't exist.", { rule_id: id });
