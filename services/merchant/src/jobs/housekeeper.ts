import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { actorOf } from "../domain/merchant-events.js";
import { TicketsRepository } from "../kitchen/tickets.repository.js";
import { TABLET_SILENT_MS } from "../outlets/outlet-mapper.js";
import { OutletStatusUpdater } from "../outlets/outlet-status.js";
import { OutletsRepository } from "../outlets/outlets.repository.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";

/**
 * Periodic upkeep, one replica at a time (transaction-scoped advisory lock):
 *  - new tickets past accept_by → missed (locally; order's timer publishes the real rejection);
 *  - a pause that has ended, or a tablet that went quiet, → OutletStatusChanged.
 */
@Injectable()
export class Housekeeper implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(TicketsRepository) private readonly tickets: TicketsRepository,
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(OutletStatusUpdater) private readonly status: OutletStatusUpdater,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.HOUSEKEEPING_INTERVAL_MS <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick(new Date())
        .catch((err: unknown) => this.logger.warn({ err }, "housekeeping failed"))
        .finally(() => (this.running = undefined));
    }, this.config.HOUSEKEEPING_INTERVAL_MS);
    this.timer.unref();
  }

  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  async tick(now: Date): Promise<void> {
    await this.database.transaction(undefined, async (tx) => {
      const [lock] = await tx
        .execute<{ ok: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext('merchant:housekeeping')) as ok`,
        )
        .then((r) => r.rows);
      if (!lock?.ok) return;
      const missed = await this.tickets.expireMissed(tx, now);
      if (missed) this.logger.info({ missed }, "tickets missed their accept window");
      const due = await this.outlets.needingStatusCheck(tx, now, new Date(now.getTime() - TABLET_SILENT_MS));
      for (const outlet of due) {
        await this.status.change(
          tx,
          outlet.id,
          actorOf(undefined, outlet.id),
          (row) => (row.pausedUntil && row.pausedUntil <= now ? { pausedUntil: null } : {}),
          now,
        );
      }
    });
  }
}
