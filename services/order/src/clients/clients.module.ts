import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { CONFIG, type Config } from "../platform/config.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { grpcCatalog, grpcPayment, grpcPricing, grpcProfile, grpcPromotion } from "./grpc-adapters.js";
import { CATALOG, PAYMENT, PRICING, PROFILE, PROMOTION, type Dependencies } from "./ports.js";
import { stubCatalog, stubPayment, stubPricing, stubProfile, stubPromotion } from "./stubs.js";

/** Builds every dependency port from <NAME>_MODE (grpc | stub) and closes the channels on shutdown. */
@Injectable()
export class DependencyClients implements OnApplicationShutdown {
  readonly deps: Dependencies;
  private readonly closers: (() => void)[] = [];

  constructor(@Inject(CONFIG) config: Config, @Inject(LOGGER) logger: Logger) {
    const pick = <T>(mode: "grpc" | "stub", grpc: () => T & { close(): void }, stub: () => T): T => {
      if (mode === "stub") return stub();
      const client = grpc();
      this.closers.push(() => client.close());
      return client;
    };
    this.deps = {
      catalog: pick(config.CATALOG_MODE, () => grpcCatalog(config), stubCatalog),
      profile: pick(config.PROFILE_MODE, () => grpcProfile(config), stubProfile),
      pricing: pick(config.PRICING_MODE, () => grpcPricing(config), stubPricing),
      promotion: pick(config.PROMOTION_MODE, () => grpcPromotion(config), stubPromotion),
      payment: pick(config.PAYMENT_MODE, () => grpcPayment(config), stubPayment),
    };
    logger.info(
      {
        catalog: config.CATALOG_MODE,
        profile: config.PROFILE_MODE,
        pricing: config.PRICING_MODE,
        promotion: config.PROMOTION_MODE,
        payment: config.PAYMENT_MODE,
      },
      "dependency modes",
    );
  }

  onApplicationShutdown(): void {
    for (const close of this.closers) close();
  }
}

@Global()
@Module({
  providers: [
    DependencyClients,
    { provide: CATALOG, useFactory: (c: DependencyClients) => c.deps.catalog, inject: [DependencyClients] },
    { provide: PROFILE, useFactory: (c: DependencyClients) => c.deps.profile, inject: [DependencyClients] },
    { provide: PRICING, useFactory: (c: DependencyClients) => c.deps.pricing, inject: [DependencyClients] },
    {
      provide: PROMOTION,
      useFactory: (c: DependencyClients) => c.deps.promotion,
      inject: [DependencyClients],
    },
    { provide: PAYMENT, useFactory: (c: DependencyClients) => c.deps.payment, inject: [DependencyClients] },
  ],
  exports: [DependencyClients, CATALOG, PROFILE, PRICING, PROMOTION, PAYMENT],
})
export class ClientsModule {}
