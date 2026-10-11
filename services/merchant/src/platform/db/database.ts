import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CONFIG, type Config } from "../config.js";
import { LOGGER, type Logger } from "../logger.js";
import { schema } from "../../db/schema.js";

export type Db = NodePgDatabase<typeof schema>;
/** A Drizzle transaction handle; pass it to repositories so their writes join the transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool-backed Db or an open transaction. */
export type Queryable = Db | Tx;

/** Something with a deadline (a gRPC RequestContext); lets DB work stop when the caller gives up. */
export interface HasDeadline {
  remainingMs(): number | undefined;
}

// Resolves to <package>/drizzle both from src/ (Vitest) and dist/ (node).
const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));
// Arbitrary constant; only needs to be stable per database. Serialises migrations across replicas.
const MIGRATION_LOCK = 72_616_401;

@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  readonly pool: pg.Pool;
  readonly db: Db;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
      application_name: config.SERVICE_NAME,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    // An idle client losing its connection (Postgres restart) emits here; unhandled it would crash.
    this.pool.on("error", (err) => this.logger.warn({ err }, "idle postgres client error"));
    this.db = drizzle(this.pool, { schema });
  }

  // Runs before any onApplicationBootstrap hook, so gRPC and the consumer start on the new schema.
  async onModuleInit(): Promise<void> {
    await this.migrate();
  }

  /** Applies pending drizzle/ migrations. Advisory lock: two replicas starting together take turns. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
      this.logger.info("database migrations applied");
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
      client.release();
    }
  }

  /**
   * Runs fn in one transaction. With a deadline, every statement inside gets
   * statement_timeout = the caller's remaining time, so a slow query is cancelled by Postgres
   * instead of finishing work nobody is waiting for.
   */
  async transaction<T>(ctx: HasDeadline | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const remaining = ctx?.remainingMs();
      if (remaining !== undefined) {
        const ms = Math.max(1, Math.floor(remaining));
        await tx.execute(sql`select set_config('statement_timeout', ${String(ms)}, true)`);
      }
      return fn(tx);
    });
  }

  async ping(timeoutMs = 1_000): Promise<void> {
    await withTimeout(this.pool.query("select 1"), timeoutMs, "postgres ping timed out");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
