import type { ServiceDefinition } from "@grpc/grpc-js";
import { DiscoveryService } from "@nestjs/core";
import type { RequestContext } from "./context.js";

/**
 * The handler shape for a ts-proto service definition: one async method per unary RPC, receiving
 * the decoded request and the caller's context. Streaming RPCs map to `never` (not supported by
 * this template yet; implement them against @grpc/grpc-js directly if you need one).
 */
export type GrpcHandlers<D> = {
  [K in keyof D]: D[K] extends {
    requestStream: false;
    responseStream: false;
    requestDeserialize: (value: Buffer) => infer Req;
    responseSerialize: (value: infer Res) => Buffer;
  }
    ? (request: Req, ctx: RequestContext) => Promise<Res>
    : never;
};

export const GrpcServiceMeta = DiscoveryService.createDecorator<ServiceDefinition>();

/**
 * Marks a Nest provider as the implementation of a gRPC service. The class must implement every
 * RPC of the definition (checked at compile time); GrpcServer finds it at startup and serves it.
 *
 *   @GrpcService(TemplateServiceService)
 *   @Injectable()
 *   export class TemplateGrpcService implements GrpcHandlers<TemplateServiceService> { ... }
 */
export function GrpcService<D extends ServiceDefinition>(definition: D) {
  return <C extends abstract new (...args: never[]) => GrpcHandlers<D>>(target: C): void => {
    GrpcServiceMeta(definition)(target);
  };
}
