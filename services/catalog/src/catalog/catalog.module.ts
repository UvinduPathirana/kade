import { Module } from "@nestjs/common";
import { CONFIG, type Config } from "../platform/config.js";
import { CLOCK } from "./access.js";
import { CatalogGrpcService } from "./catalog.grpc.js";
import { CatalogEvents } from "./events.js";
import { makeClock } from "./hours.js";
import { MenuManagementGrpcService } from "./menu-management.grpc.js";
import { MerchandisingGrpcService } from "./merchandising.grpc.js";
import { PricingGateway } from "./pricing.client.js";
import { RestaurantManagementGrpcService } from "./restaurant-management.grpc.js";
import { RestaurantViews } from "./restaurant-views.js";
import { Seeder } from "./seeder.js";
import { CatalogStore } from "./store.js";
import { UpstreamEventsConsumer } from "./upstream-events.consumer.js";

@Module({
  providers: [
    { provide: CLOCK, useFactory: (config: Config) => makeClock(config.DEMO_TIME), inject: [CONFIG] },
    CatalogStore,
    CatalogEvents,
    PricingGateway,
    RestaurantViews,
    CatalogGrpcService,
    MenuManagementGrpcService,
    RestaurantManagementGrpcService,
    MerchandisingGrpcService,
    UpstreamEventsConsumer,
    Seeder,
  ],
})
export class CatalogModule {}
