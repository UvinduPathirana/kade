import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { CreditReason } from "@kade/proto/kade/profile/v1/profile_service";
import { StaffStatus } from "@kade/proto/kade/identity/v1/identity_service";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { auditEntries, customers, rolePermissions, seedRuns, staff } from "../db/schema.js";
import { ProfileStore } from "../customers/profile-store.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database, type Tx } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import {
  DEFAULT_MATRIX,
  DEMO_CUSTOMERS,
  DEMO_KEYCLOAK_STAFF,
  SEED_AUDIT,
  SEED_STAFF,
  seedCustomers,
  seedStaffId,
} from "./demo-data.js";

const SYSTEM_ACTOR = { userId: "", roles: ["system"], outletId: "" };

/**
 * Seeds demo data once per database (each step is recorded in seed_runs, in the same transaction as
 * its rows, so restarts and concurrent replicas never duplicate it). Events go through the outbox
 * like any other change, so ledger sees the demo credit balances.
 *
 * Demo Keycloak users have fixed subs (CONVENTIONS "Seeded ids"), so no Keycloak lookup is needed.
 * If a realm ever has other ids, EnsureCustomer still gives a new customer with a demo email the
 * demo profile on first sign-in.
 */
@Injectable()
export class Seeder implements OnApplicationBootstrap {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_DEMO_DATA) return;
    try {
      await this.seedAll();
    } catch (err) {
      // Demo data must never stop the service from serving.
      this.logger.error({ err }, "demo seed failed");
    }
  }

  async seedAll(): Promise<void> {
    await this.step("demo-customers-v1", (tx) => this.demoCustomers(tx));
    await this.step("admin-customers-v1", (tx) => this.adminCustomers(tx));
    await this.step("staff-v1", (tx) => this.staff(tx));
    await this.step("audit-v1", (tx) => this.audit(tx));
  }

  private async step(name: string, run: (tx: Tx) => Promise<void>): Promise<void> {
    const ran = await this.database.transaction(undefined, async (tx) => {
      const [claimed] = await tx.insert(seedRuns).values({ name }).onConflictDoNothing().returning();
      if (!claimed) return false;
      await run(tx);
      return true;
    });
    if (ran) this.logger.info({ step: name }, "demo seed applied");
  }

  private async demoCustomers(tx: Tx): Promise<void> {
    for (const demo of DEMO_CUSTOMERS) {
      // ensure() applies the demo profile (addresses, credit, favourites) because the email matches.
      await this.store.ensure(tx, {
        id: demo.id,
        name: demo.name,
        email: demo.email,
        phone: demo.phone,
        joinedAt: new Date("2025-03-14T09:00:00+05:30"),
      });
    }
  }

  private async adminCustomers(tx: Tx): Promise<void> {
    const now = Date.now();
    for (const c of seedCustomers()) {
      const { created } = await this.store.ensure(tx, {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        joinedAt: c.joinedAt,
      });
      if (!created) continue;
      await this.store.saveAddress(tx, c.id, { ...c.address });
      await tx
        .update(customers)
        .set({
          ordersCount: c.ordersCount,
          spendMinor: c.spendMinor,
          lastOrderAt: new Date(now - c.lastOrderAgoMs),
        })
        .where(eq(customers.id, c.id));
      if (c.creditMinor > 0) {
        await this.store.changeCredit(tx, {
          customerId: c.id,
          amountMinor: c.creditMinor,
          reason: CreditReason.CREDIT_REASON_GOODWILL,
          label: "Late delivery",
          by: "Ruwani Silva",
          at: new Date(now - 6 * 86_400_000),
        });
      }
      for (const f of c.flags) {
        await this.store.raiseFlag(tx, c.id, f.kind, f.detail, {
          at: new Date(now - f.raisedAgoMs),
          status: f.status,
          resolution: f.resolution,
        });
      }
      if (c.blocked) await this.store.setBlocked(tx, c.id, true, c.blockReason, SYSTEM_ACTOR, "Dilini");
    }
  }

  private async staff(tx: Tx): Promise<void> {
    const now = Date.now();
    const rows = [
      ...DEMO_KEYCLOAK_STAFF.map((s) => ({
        ...s,
        status: StaffStatus.STAFF_STATUS_ACTIVE,
        lastActiveAt: null,
      })),
      ...SEED_STAFF.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        title: s.title,
        status: s.status,
        lastActiveAt: s.lastActiveAgoMs === undefined ? null : new Date(now - s.lastActiveAgoMs),
      })),
    ];
    // createdAt staggered so the team page keeps this order.
    await tx
      .insert(staff)
      .values(rows.map((r, i) => ({ ...r, createdAt: new Date(now - (rows.length - i) * 60_000) })))
      .onConflictDoNothing();
    for (const entry of DEFAULT_MATRIX) {
      await tx
        .insert(rolePermissions)
        .values(entry.permissionIds.map((permissionId) => ({ role: entry.role, permissionId })))
        .onConflictDoNothing();
    }
  }

  private async audit(tx: Tx): Promise<void> {
    const now = Date.now();
    const byId = new Map(SEED_STAFF.map((s) => [s.id, s]));
    await tx.insert(auditEntries).values(
      SEED_AUDIT.map((a) => {
        const who = byId.get(seedStaffId(a.staff))!;
        return {
          id: uuidv7(),
          at: new Date(now - a.agoMs),
          actorUserId: who.id,
          actorRoles: [roleName(who.role)],
          actorName: who.name,
          action: a.action,
          recordType: a.recordType,
          recordId: a.recordId,
          detail: a.detail,
        };
      }),
    );
  }
}

function roleName(role: number): string {
  return ["", "admin", "ops", "finance", "support"][role] ?? "";
}
