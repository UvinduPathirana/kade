import { Module } from "@nestjs/common";
import { DemoSeeder } from "../seed/seed.js";
import { SlaMonitor } from "./sla-monitor.js";
import { SupportGrpcService } from "./support.grpc.js";
import { TicketAdminGrpcService } from "./ticket-admin.grpc.js";
import { TicketEvents } from "./ticket-events.js";
import { TicketsRepository } from "./tickets.repository.js";
import { Upstream } from "./upstream.js";

@Module({
  providers: [
    TicketsRepository,
    TicketEvents,
    Upstream,
    SupportGrpcService,
    TicketAdminGrpcService,
    SlaMonitor,
    DemoSeeder,
  ],
})
export class TicketsModule {}
