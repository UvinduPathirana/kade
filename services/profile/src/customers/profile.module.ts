import { Module } from "@nestjs/common";
import { Downstream } from "../clients/downstream.js";
import { AuditGrpcService } from "../identity/audit.grpc.js";
import { KeycloakAdmin } from "../identity/keycloak-admin.js";
import { PhoneSignInGrpcService } from "../identity/phone-sign-in.grpc.js";
import { StaffGrpcService } from "../identity/staff.grpc.js";
import { RiskEventsConsumer } from "../risk/order-events.consumer.js";
import { Seeder } from "../seed/seeder.js";
import { AddressGrpcService } from "./address.grpc.js";
import { CreditGrpcService } from "./credit.grpc.js";
import { CustomerGrpcService } from "./customer.grpc.js";
import { FavouriteGrpcService } from "./favourite.grpc.js";
import { PlusGrpcService } from "./plus.grpc.js";
import { ProfileStore } from "./profile-store.js";

/** kade.profile.v1 (customers) and kade.identity.v1 (phone sign-in, staff, audit): one process. */
@Module({
  providers: [
    ProfileStore,
    Downstream,
    KeycloakAdmin,
    Seeder,
    RiskEventsConsumer,
    CustomerGrpcService,
    AddressGrpcService,
    FavouriteGrpcService,
    CreditGrpcService,
    PlusGrpcService,
    PhoneSignInGrpcService,
    StaffGrpcService,
    AuditGrpcService,
  ],
})
export class ProfileModule {}
