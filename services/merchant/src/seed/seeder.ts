import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { outletStaff, outlets, partnerApplications } from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { DemoBoard } from "./demo-board.js";
import { DEMO_OUTLET_ID, seedApplications, seedOutlets, seedStaff } from "./seed-data.js";

/**
 * Idempotent reference data at boot (after migrations): the 16 catalogue outlets and their teams
 * (insert-if-absent, so edits made through the API survive restarts), then the demo board.
 */
@Injectable()
export class Seeder implements OnApplicationBootstrap {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(DemoBoard) private readonly demo: DemoBoard,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_DATA) return;
    await this.seed(new Date());
  }

  async seed(now: Date): Promise<void> {
    await this.database.transaction(undefined, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('merchant:seed'))`);
      const o = await tx
        .insert(outlets)
        .values(seedOutlets(now))
        .onConflictDoNothing()
        .returning({ id: outlets.id });
      const s = await tx
        .insert(outletStaff)
        .values(seedStaff(now))
        .onConflictDoNothing()
        .returning({ id: outletStaff.id });
      const a = await tx
        .insert(partnerApplications)
        .values(seedApplications(now))
        .onConflictDoNothing()
        .returning({ id: partnerApplications.id });
      if (o.length || s.length || a.length) {
        this.logger.info(
          { outlets: o.length, staff: s.length, applications: a.length },
          "seed data inserted",
        );
      }
    });
    await this.demo.ensureFresh(DEMO_OUTLET_ID, now, false);
  }
}
