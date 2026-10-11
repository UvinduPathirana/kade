import { Module } from "@nestjs/common";
import { ApplicationsRepository } from "./applications/applications.repository.js";
import { ApplicationsGrpcService } from "./applications/applications.grpc.js";
import { CatalogClient } from "./applications/catalog-client.js";
import { MerchantEvents } from "./domain/merchant-events.js";
import { Housekeeper } from "./jobs/housekeeper.js";
import { DeliveryEventsConsumer } from "./kitchen/delivery-events.consumer.js";
import { KitchenGrpcService } from "./kitchen/kitchen.grpc.js";
import { OrderEventsConsumer } from "./kitchen/order-events.consumer.js";
import { TicketProjector } from "./kitchen/ticket-projector.js";
import { TicketsRepository } from "./kitchen/tickets.repository.js";
import { OutletAccess } from "./outlets/outlet-access.js";
import { OutletAdminGrpcService } from "./outlets/outlet-admin.grpc.js";
import { OutletStatusUpdater } from "./outlets/outlet-status.js";
import { OutletGrpcService } from "./outlets/outlet.grpc.js";
import { OutletsRepository } from "./outlets/outlets.repository.js";
import { DemoBoard } from "./seed/demo-board.js";
import { Seeder } from "./seed/seeder.js";
import { StaffGrpcService } from "./staff/staff.grpc.js";
import { StaffRepository } from "./staff/staff.repository.js";

/** Everything merchant owns: outlets, staff, kitchen tickets, onboarding. */
@Module({
  providers: [
    // data access
    OutletsRepository,
    StaffRepository,
    TicketsRepository,
    ApplicationsRepository,
    // domain
    MerchantEvents,
    OutletAccess,
    OutletStatusUpdater,
    TicketProjector,
    DemoBoard,
    CatalogClient,
    // gRPC (kade.merchant.v1)
    KitchenGrpcService,
    OutletGrpcService,
    StaffGrpcService,
    ApplicationsGrpcService,
    OutletAdminGrpcService,
    // events in
    OrderEventsConsumer,
    DeliveryEventsConsumer,
    // background
    Seeder,
    Housekeeper,
  ],
})
export class MerchantModule {}
