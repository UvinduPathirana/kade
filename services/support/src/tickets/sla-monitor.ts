import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { TicketEvents } from "./ticket-events.js";
import { TicketsRepository } from "./tickets.repository.js";

const BATCH = 100;

/**
 * Publishes TicketSlaBreached once for every unresolved ticket nobody has answered by its SLA.
 * Rows are claimed with SKIP LOCKED, so replicas never announce the same breach twice.
 */
@Injectable()
export class SlaMonitor implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(TicketsRepository) private readonly repo: TicketsRepository,
    @Inject(TicketEvents) private readonly events: TicketEvents,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.check()
        .catch((err: unknown) => this.logger.warn({ err }, "sla check failed"))
        .finally(() => (this.running = undefined));
    }, this.config.SLA_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass; returns the ids announced. */
  async check(now = new Date()): Promise<string[]> {
    return this.database.transaction(undefined, async (tx) => {
      const breached = await this.repo.newlyBreached(tx, now, BATCH);
      for (const ticket of breached) {
        const row = await this.repo.updateTicket(tx, ticket.id, { slaBreachedAt: now });
        await this.events.slaBreached(tx, row, now);
      }
      if (breached.length) this.logger.info({ count: breached.length }, "tickets breached their SLA");
      return breached.map((t) => t.id);
    });
  }
}
