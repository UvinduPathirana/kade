import { KafkaJS } from "@confluentinc/kafka-javascript";
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { CONFIG, type Config } from "../config.js";
import { withTimeout } from "../db/database.js";
import { LOGGER, type Logger } from "../logger.js";

/**
 * One Kafka client per process (librdkafka under a KafkaJS-style API). Owns the producer
 * (used for dead-lettering; business events go through the outbox, never through here) and an
 * admin client for readiness checks. Consumers are created by EventConsumerRunner.
 */
@Injectable()
export class KafkaClient implements OnModuleInit, OnApplicationShutdown {
  readonly kafka: KafkaJS.Kafka;
  readonly producer: KafkaJS.Producer;
  private readonly admin: KafkaJS.Admin;
  private lastPing: { at: number; ok: boolean } = { at: 0, ok: false };

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.kafka = new KafkaJS.Kafka({
      kafkaJS: {
        brokers: config.KAFKA_BROKERS,
        clientId: config.SERVICE_NAME,
        logger: kafkaLogger(logger),
        logLevel: KafkaJS.logLevel.WARN,
      },
    });
    this.producer = this.kafka.producer({ kafkaJS: { idempotent: true, acks: -1 } });
    this.admin = this.kafka.admin();
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.producer.connect(), this.admin.connect()]);
    this.logger.info({ brokers: this.config.KAFKA_BROKERS }, "kafka connected");
  }

  /** Cheap broker round-trip for /health/ready, cached so frequent probes don't hammer Kafka. */
  async ping(): Promise<boolean> {
    if (Date.now() - this.lastPing.at < 5_000) return this.lastPing.ok;
    let ok = false;
    try {
      await withTimeout(this.admin.listTopics({ timeout: 1_500 }), 2_000, "kafka ping timed out");
      ok = true;
    } catch (err) {
      this.logger.warn({ err }, "kafka ping failed");
    }
    this.lastPing = { at: Date.now(), ok };
    return ok;
  }

  // After consumers stopped (beforeApplicationShutdown), so a last dead-letter can still be sent.
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.producer.disconnect(), this.admin.disconnect()]);
  }
}

function kafkaLogger(root: Logger, namespace = "kafka"): KafkaJS.Logger {
  const log = root.child({ component: namespace });
  return {
    info: (message, extra) => log.info(extra ?? {}, message),
    warn: (message, extra) => log.warn(extra ?? {}, message),
    error: (message, extra) => log.error(extra ?? {}, message),
    // librdkafka debug output is very chatty; keep it below the service's own debug lines.
    debug: (message, extra) => log.trace(extra ?? {}, message),
    namespace: (ns) => kafkaLogger(root, `${namespace}.${ns}`),
    setLogLevel: () => undefined,
  };
}
