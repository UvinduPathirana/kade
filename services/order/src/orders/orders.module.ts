import { Module } from "@nestjs/common";
import { GroupOrderGrpcService } from "../groups/group.grpc.js";
import { GroupService } from "../groups/group.service.js";
import { DemoOrderSeeder } from "../seed/demo-orders.js";
import { TemporalService } from "../temporal/temporal.service.js";
import { CheckoutService } from "./checkout.js";
import { FulfilmentEventsConsumer } from "./fulfilment.consumer.js";
import { OrderGrpcService } from "./order.grpc.js";
import { OrderRepository } from "./order.repository.js";
import { OrderStore } from "./order.store.js";
import { RefundRepository } from "./refund.repository.js";
import { RefundService } from "./refund.service.js";

@Module({
  providers: [
    OrderRepository,
    RefundRepository,
    OrderStore,
    CheckoutService,
    RefundService,
    GroupService,
    TemporalService,
    OrderGrpcService,
    GroupOrderGrpcService,
    FulfilmentEventsConsumer,
    DemoOrderSeeder,
  ],
  exports: [TemporalService],
})
export class OrdersModule {}
