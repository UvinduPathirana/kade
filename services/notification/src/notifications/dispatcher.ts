import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { NotificationsRepository } from "./notifications.repository.js";
import { Notifier } from "./notifier.js";

const INTERVAL_MS = 5_000;
const BATCH = 50;

/** Sends QUEUED notifications whose send_at has passed (scheduled messages). */
@Injectable()
export class Dispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(Notifier) private readonly notifier: Notifier,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .then(() => undefined)
        .catch((err: unknown) => this.logger.warn({ err }, "notification dispatch failed"))
        .finally(() => (this.running = undefined));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** One pass; returns how many were sent. */
  async tick(now = new Date()): Promise<number> {
    return this.database.transaction(undefined, async (tx) => {
      const due = await this.repo.claimDue(tx, now, BATCH);
      for (const row of due) await this.notifier.deliver(tx, row, now);
      return due.length;
    });
  }
}
