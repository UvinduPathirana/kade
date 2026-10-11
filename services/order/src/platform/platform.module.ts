import { Global, Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { CONFIG, type Config } from "./config.js";
import { Database } from "./db/database.js";
import { GrpcServer } from "./grpc/grpc-server.js";
import { HealthController, Lifecycle, ReadinessProbes } from "./health.js";
import { IdempotencyStore } from "./idempotency/idempotency.js";
import { EventConsumerRunner } from "./kafka/event-consumer-runner.js";
import { KafkaClient } from "./kafka/kafka-client.js";
import { LOGGER, type Logger } from "./logger.js";
import { OutboxWriter } from "./outbox/outbox.js";

/**
 * Everything a service gets for free: config, logger, Postgres (+ migrations), outbox, idempotency,
 * Kafka (+ consumer runner), the gRPC server and health/metrics endpoints. Global, so feature
 * modules can inject Database, OutboxWriter, IdempotencyStore, CONFIG and LOGGER without imports.
 */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(config: Config, logger: Logger): DynamicModule {
    return {
      module: PlatformModule,
      imports: [DiscoveryModule],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
        Lifecycle,
        ReadinessProbes,
        Database,
        OutboxWriter,
        IdempotencyStore,
        KafkaClient,
        EventConsumerRunner,
        GrpcServer,
      ],
      exports: [
        CONFIG,
        LOGGER,
        Lifecycle,
        ReadinessProbes,
        Database,
        OutboxWriter,
        IdempotencyStore,
        KafkaClient,
        GrpcServer,
      ],
    };
  }
}
