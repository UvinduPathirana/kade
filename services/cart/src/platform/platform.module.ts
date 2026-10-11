import { Global, Module, type DynamicModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { CONFIG, type Config } from "./config.js";
import { GrpcServer } from "./grpc/grpc-server.js";
import { HealthController, Lifecycle } from "./health.js";
import { LOGGER, type Logger } from "./logger.js";
import { RedisClient } from "./redis/redis.js";

/**
 * What cart gets from the platform: config, logger, Redis, the gRPC server and health/metrics
 * endpoints. Carts live in Redis and cart publishes no events, so the template's Postgres, outbox,
 * idempotency and Kafka pieces are not part of this service.
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
        RedisClient,
        GrpcServer,
      ],
      exports: [CONFIG, LOGGER, Lifecycle, RedisClient, GrpcServer],
    };
  }
}
