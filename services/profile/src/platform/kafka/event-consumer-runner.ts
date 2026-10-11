import type { KafkaJS } from "@confluentinc/kafka-javascript";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  context,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { setTimeout as sleep } from "node:timers/promises";
import { processedEvents } from "../../db/schema.js";
import { CONFIG, type Config } from "../config.js";
import { Database } from "../db/database.js";
import { LOGGER, type Logger } from "../logger.js";
import { KafkaClient } from "./kafka-client.js";
import {
  EventConsumerMeta,
  eventHandlersOf,
  PermanentEventError,
  type Decoder,
  type EventContext,
} from "./event-handler.js";

/** docs/backend/CONVENTIONS.md: "after 5 attempts send to <topic>.dlq with the error in a header". */
export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 5_000;

interface Route {
  decoder: Decoder<unknown>;
  handle: (event: unknown, ctx: EventContext) => Promise<void>;
}

type Outcome = "handled" | "duplicate" | "skipped" | "dead-lettered";

/**
 * Runs one consumer (group = SERVICE_NAME) for every @EventConsumer provider. Per message:
 * extract trace context from the `traceparent` header, decode by `eventType`, then in ONE
 * transaction record the event id in processed_events and run the handler, so a redelivered
 * event is a no-op. Retries with exponential backoff; permanent failures and exhausted retries go
 * to <topic>.dlq. Offsets are committed only after that, so a crash means redelivery, not loss.
 */
@Injectable()
export class EventConsumerRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private consumer: KafkaJS.Consumer | undefined;
  private readonly routes = new Map<string, Route>();
  private readonly stopping = new AbortController();
  private readonly tracer = trace.getTracer("kafka-consumer");
  private readonly processed = metrics
    .getMeter("kafka-consumer")
    .createCounter("messaging.process.messages", { description: "Kafka messages processed, by outcome" });

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(KafkaClient) private readonly kafka: KafkaClient,
    @Inject(Database) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const topics = new Set<string>();
    for (const wrapper of this.discovery.getProviders({ metadataKey: EventConsumerMeta.KEY })) {
      const options = this.discovery.getMetadataByDecorator(EventConsumerMeta, wrapper);
      const instance = wrapper.instance as Record<string | symbol, unknown> | undefined;
      if (!options || !instance) continue;
      options.topics.forEach((t) => topics.add(t));
      for (const binding of eventHandlersOf(instance)) {
        if (this.routes.has(binding.eventType)) throw new Error(`two handlers for ${binding.eventType}`);
        const fn = instance[binding.method] as Route["handle"];
        this.routes.set(binding.eventType, { decoder: binding.decoder, handle: fn.bind(instance) });
      }
    }
    if (topics.size === 0) return;

    this.consumer = this.kafka.kafka.consumer({
      kafkaJS: {
        groupId: this.config.SERVICE_NAME,
        // A brand-new group (new service, or a projection rebuild) starts from the oldest event.
        fromBeginning: true,
        autoCommit: true,
      },
      // librdkafka prefetches up to 64 MB per consumer by default; far too much in a 192 MB container.
      "queued.max.messages.kbytes": 2048,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [...topics] });
    // run() returns once the loop is started; group join and assignment continue in the background.
    await this.consumer.run({ eachMessage: (payload) => this.onMessage(payload) });
    this.logger.info({ topics: [...topics], eventTypes: [...this.routes.keys()] }, "kafka consumer running");
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping.abort();
    // Commits offsets of fully processed messages; an interrupted one is redelivered later.
    await this.consumer?.disconnect();
  }

  private async onMessage({ topic, partition, message }: KafkaJS.EachMessagePayload): Promise<void> {
    const headers = message.headers ?? {};
    const eventType = header(headers, "eventType") ?? "";
    const eventId = header(headers, "id");
    const parent = propagation.extract(ROOT_CONTEXT, { traceparent: header(headers, "traceparent") });

    await this.tracer.startActiveSpan(
      `process ${topic}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "messaging.system": "kafka",
          "messaging.operation.type": "process",
          "messaging.destination.name": topic,
          "messaging.destination.partition.id": String(partition),
          "messaging.kafka.offset": Number(message.offset),
          "messaging.kafka.message.key": message.key?.toString() ?? "",
          "messaging.message.id": eventId ?? "",
          "messaging.consumer.group.name": this.config.SERVICE_NAME,
          "kade.event_type": eventType,
        },
      },
      parent,
      async (span) => {
        let outcome: Outcome;
        try {
          outcome = await this.process(topic, partition, message, eventType, eventId);
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err; // only when shutting down mid-retry: leave the offset uncommitted
        } finally {
          span.end();
        }
        span.setAttribute("kade.outcome", outcome);
        this.processed.add(1, { topic, event_type: eventType, outcome });
      },
    );
  }

  private async process(
    topic: string,
    partition: number,
    message: KafkaJS.KafkaMessage,
    eventType: string,
    eventId: string | undefined,
  ): Promise<Outcome> {
    const route = this.routes.get(eventType);
    // Topics carry several event types; ignoring the ones we don't care about is forward-compatible.
    if (!route) return "skipped";

    let event: unknown;
    try {
      if (!eventId || !UUID.test(eventId)) throw new PermanentEventError("missing or invalid `id` header");
      if (!message.value) throw new PermanentEventError("empty message value");
      event = route.decoder.decode(message.value);
    } catch (err) {
      await this.deadLetter(topic, partition, message, err, 1);
      return "dead-lettered";
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const handled = await this.database.transaction(undefined, async (tx) => {
          const fresh = await tx
            .insert(processedEvents)
            .values({ eventId })
            .onConflictDoNothing()
            .returning({ id: processedEvents.eventId });
          if (fresh.length === 0) return false; // already handled: Debezium/Kafka redelivery or replay
          await route.handle(event, {
            tx,
            eventId,
            eventType,
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString(),
            attempt,
          });
          return true;
        });
        return handled ? "handled" : "duplicate";
      } catch (err) {
        const permanent = err instanceof PermanentEventError;
        if (permanent || attempt >= MAX_ATTEMPTS) {
          await this.deadLetter(topic, partition, message, err, attempt);
          return "dead-lettered";
        }
        const delay =
          Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)) * (0.8 + Math.random() * 0.4);
        this.logger.warn(
          { err, topic, offset: message.offset, eventId, attempt, delay },
          "event handler failed; retrying",
        );
        await sleep(delay, undefined, { signal: this.stopping.signal });
      }
    }
  }

  private async deadLetter(
    topic: string,
    partition: number,
    message: KafkaJS.KafkaMessage,
    err: unknown,
    attempts: number,
  ): Promise<void> {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    this.logger.error({ err, topic, partition, offset: message.offset, attempts }, "event sent to DLQ");
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    await this.kafka.producer.send({
      topic: `${topic}.dlq`,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers: {
            ...message.headers,
            ...carrier,
            error,
            "original-topic": topic,
            "original-partition": String(partition),
            "original-offset": message.offset,
            attempts: String(attempts),
            "failed-by": this.config.SERVICE_NAME,
          },
        },
      ],
    });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(headers: KafkaJS.IHeaders, key: string): string | undefined {
  const v = headers[key];
  const first = Array.isArray(v) ? v[0] : v;
  // Debezium writes a null header when the outbox column is NULL (e.g. no active trace).
  return first == null ? undefined : first.toString();
}
