import { Inject, Injectable } from "@nestjs/common";
import type { EnsureCustomerResponse } from "@kade/proto/kade/profile/v1/profile_service";
import {
  CustomerServiceService,
  FraudFlagStatus,
  type CustomerStats,
  type CustomerSummary,
  type EnsureCustomerRequest,
  type GetCustomerDetailRequest,
  type GetCustomerDetailResponse,
  type GetCustomerRequest,
  type GetCustomerResponse,
  type GetPreferencesRequest,
  type GetPreferencesResponse,
  type ListCustomersRequest,
  type ListCustomersResponse,
  type ResolveFraudFlagRequest,
  type ResolveFraudFlagResponse,
  type SetCustomerBlockedRequest,
  type SetCustomerBlockedResponse,
  type UpdatePreferencesRequest,
  type UpdatePreferencesResponse,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { and, desc, eq, exists, ilike, or, sql, type SQL } from "drizzle-orm";
import { customers, fraudFlags } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { assertCustomerAccess, requireCustomerId, requireStaff } from "../shared/access.js";
import { lkr } from "../shared/money.js";
import { pageResponse, readPage } from "../shared/paging.js";
import { normalisePhone } from "../shared/phone.js";
import { actorOf, staffName } from "../identity/staff-directory.js";
import { plusToProto } from "./plus.js";
import {
  addressToProto,
  creditEntryToProto,
  flagToProto,
  ProfileStore,
  type CustomerRow,
} from "./profile-store.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = new Set(["en", "si", "ta"]);
const MAX_NAME = 80;

/** kade.profile.v1.CustomerService */
@GrpcService(CustomerServiceService)
@Injectable()
export class CustomerGrpcService implements GrpcHandlers<typeof CustomerServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
  ) {}

  async getCustomer(request: GetCustomerRequest, ctx: RequestContext): Promise<GetCustomerResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const row = await this.store.require(this.database.db, id);
    return { customer: await this.store.customerProto(this.database.db, row) };
  }

  async ensureCustomer(request: EnsureCustomerRequest, ctx: RequestContext): Promise<EnsureCustomerResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    let phone = "";
    if (request.phone.trim()) {
      phone = normalisePhone(request.phone) ?? "";
      if (!phone) {
        throw invalidArgument("PHONE_INVALID", "Enter a Sri Lankan mobile number.", { field: "phone" });
      }
    }
    // Tokens can carry odd emails (Apple relay is fine; garbage is dropped, not fatal at sign-in).
    const email = EMAIL.test(request.email.trim()) ? request.email : "";
    return this.database.transaction(ctx, async (tx) => {
      const { row, created } = await this.store.ensure(tx, {
        id,
        name: request.name.slice(0, MAX_NAME),
        email,
        phone,
        referralCode: request.referralCode,
      });
      return { customer: await this.store.customerProto(tx, row), isNew: created || !row.name };
    });
  }

  async updateProfile(request: UpdateProfileRequest, ctx: RequestContext): Promise<UpdateProfileResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const name = request.name.trim();
    if (!name) {
      throw invalidArgument("NAME_REQUIRED", "Enter your name so riders know who to ask for.", {
        field: "name",
      });
    }
    if (name.length > MAX_NAME) {
      throw invalidArgument("NAME_TOO_LONG", `Keep your name under ${MAX_NAME} characters.`, {
        field: "name",
      });
    }
    const email = request.email.trim().toLowerCase();
    if (email && !EMAIL.test(email)) {
      throw invalidArgument(
        "EMAIL_INVALID",
        "That email address looks incomplete. Check it has an @ and a domain.",
        { field: "email" },
      );
    }
    return this.database.transaction(ctx, async (tx) => {
      const row = await this.store.updateProfile(tx, id, { name, email });
      return { customer: await this.store.customerProto(tx, row) };
    });
  }

  async getPreferences(request: GetPreferencesRequest, ctx: RequestContext): Promise<GetPreferencesResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    return { preferences: await this.store.preferences(this.database.db, id) };
  }

  async updatePreferences(
    request: UpdatePreferencesRequest,
    ctx: RequestContext,
  ): Promise<UpdatePreferencesResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const p = request.preferences;
    if (!p)
      throw invalidArgument("PREFERENCES_REQUIRED", "preferences is required.", { field: "preferences" });
    const language = p.language || "en";
    if (!LANGUAGES.has(language)) {
      throw invalidArgument("LANGUAGE_UNSUPPORTED", "Choose English, Sinhala or Tamil.", {
        field: "preferences.language",
      });
    }
    return this.database.transaction(ctx, async (tx) => {
      await this.store.ensure(tx, { id });
      return { preferences: await this.store.savePreferences(tx, id, { ...p, language }) };
    });
  }

  async listCustomers(request: ListCustomersRequest, ctx: RequestContext): Promise<ListCustomersResponse> {
    requireStaff(ctx);
    const page = readPage(request.page, 25, 100);
    const where: SQL[] = [];
    const q = request.query.trim();
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const digits = q.replace(/\D/g, "");
      const ors = [ilike(customers.name, like), ilike(customers.email, like), eq(customers.id, q)];
      // "077 123" matches "+9477123…": compare on digits without the leading 0.
      if (digits.length >= 3) ors.push(ilike(customers.phone, `%${digits.replace(/^0/, "")}%`));
      where.push(or(...ors)!);
    }
    if (request.blockedOnly) where.push(eq(customers.blocked, true));
    const openFlag = this.database.db
      .select({ one: sql`1` })
      .from(fraudFlags)
      .where(
        and(
          eq(fraudFlags.customerId, customers.id),
          eq(fraudFlags.status, FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN),
        ),
      );
    if (request.flaggedOnly) where.push(exists(openFlag));
    const filter = where.length ? and(...where) : undefined;

    const rows = await this.database.db
      .select({
        customer: customers,
        openFlags: sql<number>`(select count(*)::int from fraud_flags f where f.customer_id = "customers"."id" and f.status = ${FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN})`,
      })
      .from(customers)
      .where(filter)
      .orderBy(desc(customers.joinedAt), desc(customers.id))
      .limit(page.limit)
      .offset(page.offset);
    const [{ n } = { n: 0 }] = await this.database.db
      .select({ n: sql<number>`count(*)::int` })
      .from(customers)
      .where(filter);

    const summaries: CustomerSummary[] = [];
    for (const r of rows) {
      summaries.push({
        customer: await this.store.customerProto(this.database.db, r.customer),
        stats: stats(r.customer),
        creditBalance: lkr(r.customer.creditBalanceMinor),
        openFlags: r.openFlags,
      });
    }
    return { customers: summaries, page: pageResponse(page, rows.length, n) };
  }

  async getCustomerDetail(
    request: GetCustomerDetailRequest,
    ctx: RequestContext,
  ): Promise<GetCustomerDetailResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const db = this.database.db;
    const row = await this.store.require(db, id);
    const [plus, history, flags, addresses] = await Promise.all([
      this.store.plusRow(db, id),
      this.store.creditHistory(db, id, 50, 0),
      this.store.flags(db, id),
      this.store.listAddresses(db, id),
    ]);
    return {
      customer: this.store.toProto(row, plus),
      stats: stats(row),
      credit: {
        customerId: id,
        balance: lkr(row.creditBalanceMinor),
        history: history.rows.map(creditEntryToProto),
      },
      flags: flags.map(flagToProto),
      addresses: addresses.map(addressToProto),
      plus: plusToProto(plus, Date.now()),
    };
  }

  async setCustomerBlocked(
    request: SetCustomerBlockedRequest,
    ctx: RequestContext,
  ): Promise<SetCustomerBlockedResponse> {
    requireStaff(ctx, "ops", "support", "admin");
    const id = requireCustomerId(request.customerId);
    const reason = request.reason.trim();
    if (request.blocked && !reason) {
      throw invalidArgument("BLOCK_REASON_REQUIRED", "Say why you're blocking this customer.", {
        field: "reason",
      });
    }
    return this.database.transaction(ctx, async (tx) => {
      const name = await staffName(tx, ctx.userId);
      const row = await this.store.setBlocked(tx, id, request.blocked, reason, actorOf(ctx), name);
      return { customer: await this.store.customerProto(tx, row) };
    });
  }

  async resolveFraudFlag(
    request: ResolveFraudFlagRequest,
    ctx: RequestContext,
  ): Promise<ResolveFraudFlagResponse> {
    requireStaff(ctx, "ops", "support", "admin");
    const id = requireCustomerId(request.customerId);
    if (
      request.status !== FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED &&
      request.status !== FraudFlagStatus.FRAUD_FLAG_STATUS_ACTIONED
    ) {
      throw invalidArgument("FLAG_STATUS_INVALID", "Resolve a flag as cleared or actioned.", {
        field: "status",
      });
    }
    return this.database.transaction(ctx, async (tx) => {
      const who = await staffName(tx, ctx.userId);
      const verb = request.status === FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED ? "Cleared" : "Actioned";
      const note =
        request.resolution.trim() ||
        (request.status === FraudFlagStatus.FRAUD_FLAG_STATUS_CLEARED ? "Looked genuine" : "Action taken");
      const flag = await this.store.resolveFlag(
        tx,
        id,
        request.flagId.trim(),
        request.status,
        `${note.replace(/\.$/, "")}. ${verb} by ${who.split(" ")[0]}.`,
        ctx.userId ?? "",
      );
      return { flag: flagToProto(flag) };
    });
  }
}

function stats(row: CustomerRow): CustomerStats {
  return {
    ordersCount: row.ordersCount,
    spend: lkr(row.spendMinor),
    lastOrderAt: row.lastOrderAt ?? undefined,
  };
}
