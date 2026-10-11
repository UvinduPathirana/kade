import { Module } from "@nestjs/common";
import { PricingGrpcService } from "./pricing.grpc.js";
import { RulesRepository } from "./rules.repository.js";

@Module({
  providers: [RulesRepository, PricingGrpcService],
})
export class PricingModule {}
