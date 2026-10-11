import { Module } from "@nestjs/common";
import { CartGrpcService } from "./cart.grpc.js";
import { CartStore } from "./cart.store.js";
import { CATALOG, GrpcDependencies, PRICING, PROFILE, PROMOTION } from "./dependencies.js";

@Module({
  providers: [
    CartStore,
    GrpcDependencies,
    { provide: CATALOG, useExisting: GrpcDependencies },
    { provide: PRICING, useExisting: GrpcDependencies },
    { provide: PROMOTION, useExisting: GrpcDependencies },
    { provide: PROFILE, useExisting: GrpcDependencies },
    CartGrpcService,
  ],
})
export class CartModule {}
