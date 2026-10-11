import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import { CONFIG, type Config } from "../config.js";
import { LOGGER, type Logger } from "../logger.js";

/**
 * One shared ioredis connection. Commands fail fast (one retry, 2 s command timeout) instead of
 * queueing forever while Redis is down, so callers get UNAVAILABLE within their deadline.
 */
@Injectable()
export class RedisClient implements OnModuleInit, OnApplicationShutdown {
  readonly redis: Redis;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.redis = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      connectionName: config.SERVICE_NAME,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      maxRetriesPerRequest: 1,
      // Reconnect forever with capped backoff; readiness reports the outage meanwhile.
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    this.redis.on("error", (err) => this.logger.warn({ err: err.message }, "redis error"));
  }

  async onModuleInit(): Promise<void> {
    // Don't block startup on Redis: readiness stays 503 until it is reachable.
    await this.redis
      .connect()
      .catch((err: unknown) => this.logger.warn({ err }, "redis not reachable at startup"));
  }

  async ping(timeoutMs = 1_000): Promise<void> {
    await withTimeout(this.redis.ping(), timeoutMs, "redis ping timed out");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
