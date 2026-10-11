import { Global, Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { CONFIG, type Config } from "./config.js";
import { Database } from "./db/database.js";
import { GrpcServer } from "./grpc/grpc-server.js";
import { HealthController, Lifecycle } from "./health.js";
import { IdempotencyStore } from "./idempotency/idempotency.js";
import { LOGGER, type Logger } from "./logger.js";
import { OutboxWriter } from "./outbox/outbox.js";

/**
 * Everything a service gets for free: config, logger, Postgres (+ migrations), outbox, idempotency,
 * the gRPC server and health/metrics endpoints. Pricing neither publishes nor consumes events, so
 * the template's Kafka client and consumer runner are not wired in. Global, so feature
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
        Database,
        OutboxWriter,
        IdempotencyStore,
        GrpcServer,
      ],
      exports: [CONFIG, LOGGER, Lifecycle, Database, OutboxWriter, IdempotencyStore, GrpcServer],
    };
  }
}
