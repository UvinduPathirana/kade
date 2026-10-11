import { Module, type DynamicModule } from "@nestjs/common";
import { PricingModule } from "./pricing/pricing.module.js";
import type { Config } from "./platform/config.js";
import type { Logger } from "./platform/logger.js";
import { PlatformModule } from "./platform/platform.module.js";

@Module({})
export class AppModule {
  // Config and logger are passed in (not read inside) so tests can boot the app with overrides.
  static forRoot(config: Config, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config, logger), PricingModule],
    };
  }
}
