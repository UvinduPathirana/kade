import { Module } from "@nestjs/common";
import { DemoSeeder } from "../seed/seed.js";
import { OrderEventsConsumer } from "./order-events.consumer.js";
import { OrderLookup } from "./order-lookup.js";
import { ReviewGrpcService } from "./reviews.grpc.js";
import { ReviewsRepository } from "./reviews.repository.js";

@Module({
  providers: [ReviewsRepository, OrderLookup, ReviewGrpcService, OrderEventsConsumer, DemoSeeder],
})
export class ReviewsModule {}
