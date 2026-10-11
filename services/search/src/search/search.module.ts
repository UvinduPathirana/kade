import { Module } from "@nestjs/common";
import { CONFIG, type Config } from "../platform/config.js";
import { Backfill } from "./backfill.js";
import { CatalogEventsConsumer } from "./catalog-events.consumer.js";
import { makeClock } from "./hours.js";
import { PricingGateway } from "./pricing.client.js";
import { Projection } from "./projection.js";
import { SearchGrpcService } from "./search.grpc.js";
import { CLOCK, SearchIndex } from "./search-index.js";
import { SearchSeeder } from "./seeder.js";

@Module({
  providers: [
    { provide: CLOCK, useFactory: (config: Config) => makeClock(config.DEMO_TIME), inject: [CONFIG] },
    Projection,
    SearchIndex,
    PricingGateway,
    Backfill,
    SearchSeeder,
    CatalogEventsConsumer,
    SearchGrpcService,
  ],
})
export class SearchModule {}
