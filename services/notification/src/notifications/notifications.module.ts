import { Module } from "@nestjs/common";
import { DeliveryEventsConsumer } from "./consumers/delivery-events.consumer.js";
import { OrderEventsConsumer } from "./consumers/order-events.consumer.js";
import {
  MerchantEventsConsumer,
  PaymentEventsConsumer,
  TicketEventsConsumer,
} from "./consumers/other-events.consumer.js";
import { DevSink } from "./dev-sink.js";
import { Dispatcher } from "./dispatcher.js";
import { NotificationGrpcService } from "./notifications.grpc.js";
import { NotificationsRepository } from "./notifications.repository.js";
import { Notifier } from "./notifier.js";

@Module({
  providers: [
    NotificationsRepository,
    DevSink,
    Notifier,
    Dispatcher,
    NotificationGrpcService,
    OrderEventsConsumer,
    DeliveryEventsConsumer,
    PaymentEventsConsumer,
    TicketEventsConsumer,
    MerchantEventsConsumer,
  ],
})
export class NotificationsModule {}
