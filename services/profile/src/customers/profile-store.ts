import { Inject, Injectable } from "@nestjs/common";
import type { Address } from "@kade/proto/kade/common/v1/address";
import type { Actor } from "@kade/proto/kade/common/v1/types";
import {
  CustomerBlockChanged,
  CustomerCreditChanged,
  CustomerProfileUpdated,
  CustomerRegistered,
  FraudFlagRaised,
  PlusMembershipChanged,
} from "@kade/proto/kade/profile/v1/profile_events";
import {
  CreditReason,
  FraudFlagStatus,
  type CreditEntry,
  type Customer,
  type FraudFlag,
  type FraudFlagKind,
  type Preferences,
} from "@kade/proto/kade/profile/v1/profile_service";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  addresses,
  creditEntries,
  creditReversals,
  customers,
  favourites,
  fraudFlags,
  plusMemberships,
  preferences,
} from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import type { Queryable, Tx } from "../platform/db/database.js";
import { failedPrecondition, notFound } from "../platform/grpc/errors.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import { lkr } from "../shared/money.js";
import { isPhonePlaceholderEmail } from "../shared/phone.js";
import { demoProfileByEmail, type DemoCustomerProfile } from "../seed/demo-data.js";
import { DEFAULT_LABELS } from "./credit-rules.js";
import { plusActive, plusToProto, type PlusRow } from "./plus.js";

export type CustomerRow = typeof customers.$inferSelect;
export type AddressRow = typeof addresses.$inferSelect;
export type CreditEntryRow = typeof creditEntries.$inferSelect;
export type FlagRow = typeof fraudFlags.$inferSelect;
export type PreferencesRow = typeof preferences.$inferSelect;

export const EVENTS = {
  registered: "kade.profile.v1.CustomerRegistered",
  updated: "kade.profile.v1.CustomerProfileUpdated",
  blockChanged: "kade.profile.v1.CustomerBlockChanged",
  creditChanged: "kade.profile.v1.CustomerCreditChanged",
  plusChanged: "kade.profile.v1.PlusMembershipChanged",
  flagRaised: "kade.profile.v1.FraudFlagRaised",
} as const;
const AGGREGATE = "customer"; // -> kade.customer.events

export const MAX_ADDRESSES = 20;
export const MAX_FAVOURITES = 200;

export interface EnsureInput {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  referralCode?: string;
  joinedAt?: Date;
  area?: string;
}

export interface CreditChange {
  customerId: string;
  amountMinor: number;
  reason: CreditReason;
  label?: string;
  orderId?: string;
  ticketId?: string;
  by?: string;
  at?: Date;
}

export interface NewAddress {
  id?: string;
  label: string;
  line: string;
  area: string;
  note: string;
  lat?: number | null;
  lng?: number | null;
  zoneId: string;
}

/**
 * Data access + domain rules for the customer aggregate. Every write takes the caller's Tx so the
 * state change and its outbox event commit together; handlers own the transaction boundary.
 */
@Injectable()
export class ProfileStore {
  constructor(
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  // -------------------------------------------------------------------------------- customers

  async find(db: Queryable, id: string): Promise<CustomerRow | undefined> {
    const [row] = await db.select().from(customers).where(eq(customers.id, id));
    return row;
  }

  async require(db: Queryable, id: string): Promise<CustomerRow> {
    const row = await this.find(db, id);
    if (!row) throw notFound("CUSTOMER_NOT_FOUND", "We couldn't find that customer.", { customerId: id });
    return row;
  }

  /** Row lock: credit and Plus changes for one customer serialise on this. */
  async lock(tx: Tx, id: string): Promise<CustomerRow> {
    const [row] = await tx.select().from(customers).where(eq(customers.id, id)).for("update");
    if (!row) throw notFound("CUSTOMER_NOT_FOUND", "We couldn't find that customer.", { customerId: id });
    return row;
  }

  /**
   * Creates the customer on first sight (idempotent on id), or fills in fields that are still empty
   * (never overwrites what the customer edited). Phone-account placeholder emails are ignored.
   * A brand-new customer whose email belongs to a demo user gets the demo profile.
   */
  async ensure(tx: Tx, input: EnsureInput): Promise<{ row: CustomerRow; created: boolean }> {
    const email = clean(input.email);
    const phoneAccount = isPhonePlaceholderEmail(email);
    const name = phoneAccount ? "" : clean(input.name);
    const realEmail = phoneAccount ? "" : email.toLowerCase();
    const phone = clean(input.phone);

    const [inserted] = await tx
      .insert(customers)
      .values({
        id: input.id,
        name,
        email: realEmail,
        phone,
        area: input.area ?? "",
        referralCode: clean(input.referralCode),
        ...(input.joinedAt ? { joinedAt: input.joinedAt } : {}),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      await tx.insert(preferences).values({ customerId: inserted.id }).onConflictDoNothing();
      await this.emit(tx, inserted.id, EVENTS.registered, CustomerRegistered, {
        customerId: inserted.id,
        customer: this.toProto(inserted, undefined),
        referralCode: inserted.referralCode,
        occurredAt: new Date(),
      });
      const demo = realEmail ? demoProfileByEmail(realEmail) : undefined;
      if (demo) await this.applyDemoProfile(tx, inserted.id, demo);
      return { row: (await this.find(tx, inserted.id))!, created: true };
    }

    const existing = await this.lock(tx, input.id);
    const fill: Partial<CustomerRow> = {};
    if (!existing.name && name) fill.name = name;
    if (!existing.email && realEmail) fill.email = realEmail;
    if (!existing.phone && phone) fill.phone = phone;
    if (Object.keys(fill).length === 0) return { row: existing, created: false };
    const [updated] = await tx
      .update(customers)
      .set({ ...fill, updatedAt: new Date() })
      .where(eq(customers.id, input.id))
      .returning();
    await this.emitUpdated(tx, updated!);
    return { row: updated!, created: false };
  }

  /** Dilini's (and any demo customer's) saved addresses, referral credit and favourites. */
  async applyDemoProfile(tx: Tx, customerId: string, demo: DemoCustomerProfile): Promise<void> {
    const now = Date.now();
    const row = await this.lock(tx, customerId);
    const fill: Partial<CustomerRow> = {};
    if (!row.name) fill.name = demo.name;
    if (!row.phone) fill.phone = demo.phone;
    if (!row.email) fill.email = demo.email;
    if (Object.keys(fill).length) await tx.update(customers).set(fill).where(eq(customers.id, customerId));
    for (const a of demo.addresses) {
      await this.saveAddress(tx, customerId, { ...a });
    }
    for (const c of demo.credit) {
      await this.changeCredit(tx, {
        customerId,
        amountMinor: c.amountMinor,
        reason: CreditReason.CREDIT_REASON_REFERRAL,
        label: c.label,
        at: new Date(now - c.daysAgo * 86_400_000),
      });
    }
    for (const [i, restaurantId] of this.config.SEED_FAVOURITE_RESTAURANT_IDS.entries()) {
      await tx
        .insert(favourites)
        .values({ customerId, restaurantId, addedAt: new Date(now - (i + 1) * 3 * 86_400_000) })
        .onConflictDoNothing();
    }
  }

  async plusRow(db: Queryable, customerId: string): Promise<PlusRow | undefined> {
    const [row] = await db.select().from(plusMemberships).where(eq(plusMemberships.customerId, customerId));
    return row;
  }

  async customerProto(db: Queryable, row: CustomerRow): Promise<Customer> {
    return this.toProto(row, await this.plusRow(db, row.id));
  }

  toProto(row: CustomerRow, plus: PlusRow | undefined): Customer {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      area: row.area,
      joinedAt: row.joinedAt,
      blocked: row.blocked,
      blockReason: row.blockReason,
      plusActive: plusActive(plus, Date.now()),
    };
  }

  async updateProfile(tx: Tx, id: string, set: { name: string; email: string }): Promise<CustomerRow> {
    await this.lock(tx, id);
    const [row] = await tx
      .update(customers)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    await this.emitUpdated(tx, row!);
    return row!;
  }

  async setBlocked(
    tx: Tx,
    id: string,
    blocked: boolean,
    reason: string,
    actor: Actor,
    actorName: string,
  ): Promise<CustomerRow> {
    const before = await this.lock(tx, id);
    const [row] = await tx
      .update(customers)
      .set({ blocked, blockReason: blocked ? reason : "", updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (blocked) {
      // Blocking deals with every open flag (same as the admin console's mock).
      await tx
        .update(fraudFlags)
        .set({
          status: FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED,
          resolution: `Blocked by ${actorName}`,
          resolvedBy: actor.userId,
          resolvedAt: new Date(),
        })
        .where(
          and(eq(fraudFlags.customerId, id), eq(fraudFlags.status, FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN)),
        );
    }
    if (before.blocked !== blocked || before.blockReason !== row!.blockReason) {
      await this.emit(tx, id, EVENTS.blockChanged, CustomerBlockChanged, {
        customerId: id,
        blocked,
        reason,
        actor,
        occurredAt: new Date(),
      });
    }
    return row!;
  }

  private async emitUpdated(tx: Tx, row: CustomerRow): Promise<void> {
    await this.emit(tx, row.id, EVENTS.updated, CustomerProfileUpdated, {
      customerId: row.id,
      customer: this.toProto(row, await this.plusRow(tx, row.id)),
      occurredAt: new Date(),
    });
  }

  private async emit<T>(
    tx: Tx,
    customerId: string,
    type: string,
    codec: { encode(m: T): { finish(): Uint8Array } },
    message: T,
  ): Promise<void> {
    await this.outbox.append(tx, {
      aggregateType: AGGREGATE,
      aggregateId: customerId,
      type,
      payload: codec.encode(message).finish(),
    });
  }

  // -------------------------------------------------------------------------------- preferences

  async preferences(db: Queryable, customerId: string): Promise<Preferences> {
    const [row] = await db.select().from(preferences).where(eq(preferences.customerId, customerId));
    return prefsToProto(row);
  }

  async savePreferences(tx: Tx, customerId: string, p: Preferences): Promise<Preferences> {
    const values = {
      marketingSms: p.marketingSms,
      marketingEmail: p.marketingEmail,
      orderUpdatesPush: p.orderUpdatesPush,
      orderUpdatesSms: p.orderUpdatesSms,
      vegetarian: p.vegetarian,
      language: p.language,
      updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(preferences)
      .values({ customerId, ...values })
      .onConflictDoUpdate({ target: preferences.customerId, set: values })
      .returning();
    return prefsToProto(row);
  }

  // -------------------------------------------------------------------------------- addresses

  async listAddresses(db: Queryable, customerId: string): Promise<AddressRow[]> {
    return db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, customerId))
      .orderBy(asc(addresses.createdAt), asc(addresses.id));
  }

  /** Adds, or replaces the address with the same id. Keeps the customer's area in step. */
  async saveAddress(tx: Tx, customerId: string, a: NewAddress): Promise<AddressRow> {
    const id = a.id || uuidv7();
    const values = {
      label: a.label,
      line: a.line,
      area: a.area,
      note: a.note,
      lat: a.lat ?? null,
      lng: a.lng ?? null,
      zoneId: a.zoneId,
      updatedAt: new Date(),
    };
    const [existing] = await tx
      .select({ id: addresses.id })
      .from(addresses)
      .where(and(eq(addresses.customerId, customerId), eq(addresses.id, id)));
    if (!existing) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(addresses)
        .where(eq(addresses.customerId, customerId));
      if (n >= MAX_ADDRESSES) {
        throw failedPrecondition(
          "ADDRESS_LIMIT",
          `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.`,
        );
      }
    }
    const [row] = await tx
      .insert(addresses)
      .values({ customerId, id, ...values })
      .onConflictDoUpdate({ target: [addresses.customerId, addresses.id], set: values })
      .returning();
    await this.refreshArea(tx, customerId);
    return row!;
  }

  async removeAddress(tx: Tx, customerId: string, id: string): Promise<boolean> {
    const removed = await tx
      .delete(addresses)
      .where(and(eq(addresses.customerId, customerId), eq(addresses.id, id)))
      .returning({ id: addresses.id });
    if (removed.length) await this.refreshArea(tx, customerId);
    return removed.length > 0;
  }

  /** customers.area = the Home address's area, else the first saved address's. */
  private async refreshArea(tx: Tx, customerId: string): Promise<void> {
    const list = await this.listAddresses(tx, customerId);
    const home = list.find((a) => a.label.toLowerCase() === "home") ?? list[0];
    await tx
      .update(customers)
      .set({ area: home?.area ?? "" })
      .where(eq(customers.id, customerId));
  }

  // -------------------------------------------------------------------------------- favourites

  async listFavourites(db: Queryable, customerId: string) {
    return db
      .select()
      .from(favourites)
      .where(eq(favourites.customerId, customerId))
      .orderBy(desc(favourites.addedAt));
  }

  async addFavourite(tx: Tx, customerId: string, restaurantId: string) {
    const [inserted] = await tx
      .insert(favourites)
      .values({ customerId, restaurantId })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(favourites)
        .where(eq(favourites.customerId, customerId));
      if (n > MAX_FAVOURITES) {
        throw failedPrecondition("FAVOURITE_LIMIT", `You can save up to ${MAX_FAVOURITES} favourites.`);
      }
      return inserted;
    }
    const [existing] = await tx
      .select()
      .from(favourites)
      .where(and(eq(favourites.customerId, customerId), eq(favourites.restaurantId, restaurantId)));
    return existing!;
  }

  async removeFavourite(tx: Tx, customerId: string, restaurantId: string): Promise<void> {
    await tx
      .delete(favourites)
      .where(and(eq(favourites.customerId, customerId), eq(favourites.restaurantId, restaurantId)));
  }

  // -------------------------------------------------------------------------------- credit

  /**
   * Moves credit. Locks the customer row so concurrent spends can't overdraw. Spending more than the
   * balance fails CREDIT_INSUFFICIENT. A reversal (ORDER_SPEND_REVERSED) gives back at most what the
   * order actually spent and records a tombstone, so a spend that arrives after its compensation is
   * refused (ORDER_CREDIT_REVERSED). A reversal with nothing to reverse returns no entry.
   */
  async changeCredit(
    tx: Tx,
    change: CreditChange,
  ): Promise<{ entry: CreditEntryRow | undefined; balanceMinor: number }> {
    const customer = await this.lock(tx, change.customerId);
    const orderId = change.orderId ?? "";
    let amount = change.amountMinor;

    if (change.reason === CreditReason.CREDIT_REASON_ORDER_SPEND) {
      const [reversed] = await tx
        .select()
        .from(creditReversals)
        .where(and(eq(creditReversals.customerId, customer.id), eq(creditReversals.orderId, orderId)));
      if (reversed) {
        throw failedPrecondition(
          "ORDER_CREDIT_REVERSED",
          "This order's credit was already returned; it can't be spent again.",
          { orderId },
        );
      }
    }

    if (change.reason === CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED) {
      await tx.insert(creditReversals).values({ customerId: customer.id, orderId }).onConflictDoNothing();
      const [{ net } = { net: 0 }] = await tx
        .select({ net: sql<number>`coalesce(sum(${creditEntries.amountMinor}), 0)::bigint` })
        .from(creditEntries)
        .where(
          and(
            eq(creditEntries.customerId, customer.id),
            eq(creditEntries.orderId, orderId),
            inArray(creditEntries.reason, [
              CreditReason.CREDIT_REASON_ORDER_SPEND,
              CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED,
            ]),
          ),
        );
      const outstanding = -Number(net); // spent and not yet returned
      amount = Math.min(amount, Math.max(0, outstanding));
      if (amount <= 0) return { entry: undefined, balanceMinor: customer.creditBalanceMinor };
    }

    const balanceAfter = customer.creditBalanceMinor + amount;
    if (balanceAfter < 0) {
      throw failedPrecondition("CREDIT_INSUFFICIENT", "You don't have enough Kadé credit for that.", {
        balanceMinor: String(customer.creditBalanceMinor),
      });
    }
    const [entry] = await tx
      .insert(creditEntries)
      .values({
        id: uuidv7(),
        customerId: customer.id,
        at: change.at ?? new Date(),
        amountMinor: amount,
        label: change.label?.trim() || DEFAULT_LABELS[change.reason] || "",
        reason: change.reason,
        orderId,
        ticketId: change.ticketId ?? "",
        by: change.by ?? "",
        balanceAfterMinor: balanceAfter,
      })
      .returning();
    await tx
      .update(customers)
      .set({ creditBalanceMinor: balanceAfter, updatedAt: new Date() })
      .where(eq(customers.id, customer.id));
    await this.emit(tx, customer.id, EVENTS.creditChanged, CustomerCreditChanged, {
      customerId: customer.id,
      entry: creditEntryToProto(entry!),
      occurredAt: new Date(),
    });
    return { entry: entry!, balanceMinor: balanceAfter };
  }

  async creditHistory(db: Queryable, customerId: string, limit: number, offset: number) {
    const rows = await db
      .select()
      .from(creditEntries)
      .where(eq(creditEntries.customerId, customerId))
      .orderBy(desc(creditEntries.at), desc(creditEntries.id))
      .limit(limit)
      .offset(offset);
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditEntries)
      .where(eq(creditEntries.customerId, customerId));
    return { rows, total: n };
  }

  // -------------------------------------------------------------------------------- plus

  async savePlus(tx: Tx, row: PlusRow): Promise<PlusRow> {
    const { customerId, ...rest } = row;
    const [saved] = await tx
      .insert(plusMemberships)
      .values(row)
      .onConflictDoUpdate({ target: plusMemberships.customerId, set: { ...rest, updatedAt: new Date() } })
      .returning();
    await this.emit(tx, customerId, EVENTS.plusChanged, PlusMembershipChanged, {
      customerId,
      membership: plusToProto(saved!, Date.now()),
      occurredAt: new Date(),
    });
    return saved!;
  }

  // -------------------------------------------------------------------------------- fraud flags

  async flags(db: Queryable, customerId: string): Promise<FlagRow[]> {
    return db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.customerId, customerId))
      .orderBy(desc(fraudFlags.raisedAt));
  }

  /** Raises a flag unless one of the same kind is already open. Returns the new flag, if any. */
  async raiseFlag(
    tx: Tx,
    customerId: string,
    kind: FraudFlagKind,
    detail: string,
    opts: { at?: Date; status?: FraudFlagStatus; resolution?: string } = {},
  ): Promise<FlagRow | undefined> {
    const status = opts.status ?? FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN;
    if (status === FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN) {
      const [open] = await tx
        .select({ id: fraudFlags.id })
        .from(fraudFlags)
        .where(
          and(
            eq(fraudFlags.customerId, customerId),
            eq(fraudFlags.kind, kind),
            eq(fraudFlags.status, FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN),
          ),
        );
      if (open) return undefined;
    }
    const [flag] = await tx
      .insert(fraudFlags)
      .values({
        id: uuidv7(),
        customerId,
        kind,
        detail,
        raisedAt: opts.at ?? new Date(),
        status,
        resolution: opts.resolution ?? "",
      })
      .returning();
    await this.emit(tx, customerId, EVENTS.flagRaised, FraudFlagRaised, {
      customerId,
      flag: flagToProto(flag!),
      occurredAt: new Date(),
    });
    return flag;
  }

  async resolveFlag(
    tx: Tx,
    customerId: string,
    flagId: string,
    status: FraudFlagStatus,
    resolution: string,
    by: string,
  ): Promise<FlagRow> {
    if (!UUID.test(flagId)) throw notFound("FLAG_NOT_FOUND", "We couldn't find that flag.", { flagId });
    const [flag] = await tx
      .select()
      .from(fraudFlags)
      .where(and(eq(fraudFlags.id, flagId), eq(fraudFlags.customerId, customerId)))
      .for("update");
    if (!flag) throw notFound("FLAG_NOT_FOUND", "We couldn't find that flag.", { flagId });
    if (flag.status !== FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN) {
      throw failedPrecondition("FLAG_ALREADY_RESOLVED", "Someone already resolved this flag.", { flagId });
    }
    const [row] = await tx
      .update(fraudFlags)
      .set({ status, resolution, resolvedBy: by, resolvedAt: new Date() })
      .where(eq(fraudFlags.id, flagId))
      .returning();
    return row!;
  }
}

// -------------------------------------------------------------------------------- mapping

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: string | undefined): string => (s ?? "").trim();

export const DEFAULT_PREFERENCES: Preferences = {
  marketingSms: false,
  marketingEmail: false,
  orderUpdatesPush: true,
  orderUpdatesSms: true,
  vegetarian: false,
  language: "en",
};

export function prefsToProto(row: PreferencesRow | undefined): Preferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    marketingSms: row.marketingSms,
    marketingEmail: row.marketingEmail,
    orderUpdatesPush: row.orderUpdatesPush,
    orderUpdatesSms: row.orderUpdatesSms,
    vegetarian: row.vegetarian,
    language: row.language,
  };
}

export function addressToProto(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    line: row.line,
    area: row.area,
    note: row.note,
    location: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : undefined,
    zoneId: row.zoneId,
  };
}

export function creditEntryToProto(row: CreditEntryRow): CreditEntry {
  return {
    id: row.id,
    at: row.at,
    amount: lkr(row.amountMinor),
    label: row.label,
    reason: row.reason,
    orderId: row.orderId,
    ticketId: row.ticketId,
    by: row.by,
    balanceAfter: lkr(row.balanceAfterMinor),
  };
}

export function flagToProto(row: FlagRow): FraudFlag {
  return {
    id: row.id,
    kind: row.kind,
    detail: row.detail,
    raisedAt: row.raisedAt,
    status: row.status,
    resolution: row.resolution,
  };
}
