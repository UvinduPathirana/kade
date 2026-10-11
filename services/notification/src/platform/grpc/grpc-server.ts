import {
  Server,
  ServerCredentials,
  status,
  type sendUnaryData,
  type ServerUnaryCall,
  type ServiceDefinition,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { metrics } from "@opentelemetry/api";
import { CONFIG, type Config } from "../config.js";
import { LOGGER, type Logger } from "../logger.js";
import { contextFromCall } from "./context.js";
import { DomainError, toGrpcError } from "./errors.js";
import { GrpcServiceMeta } from "./grpc-service.js";

type UnaryHandler = (request: unknown, ctx: ReturnType<typeof contextFromCall>["ctx"]) => Promise<unknown>;

/**
 * Hosts every @GrpcService provider on GRPC_PORT with plain @grpc/grpc-js and the ts-proto
 * definitions (no @nestjs/microservices: one less layer between the proto and the handler).
 * Per call it builds the RequestContext, enforces the deadline, maps errors to status + ErrorInfo
 * and records rpc.server.duration.
 */
@Injectable()
export class GrpcServer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly server = new Server();
  private readonly duration = metrics
    .getMeter("grpc-server")
    .createHistogram("rpc.server.duration", { unit: "ms", description: "Duration of inbound gRPC calls" });
  private started = false;
  /** Actual bound port (differs from GRPC_PORT when it is 0, as in tests). */
  port = 0;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const providers = this.discovery.getProviders({ metadataKey: GrpcServiceMeta.KEY });
    for (const wrapper of providers) {
      const definition = this.discovery.getMetadataByDecorator(GrpcServiceMeta, wrapper);
      if (!definition || !wrapper.instance) continue;
      this.server.addService(definition, this.adapt(definition, wrapper.instance as object));
      this.logger.info(
        { service: wrapper.name, methods: Object.keys(definition) },
        "grpc service registered",
      );
    }
    this.port = await new Promise<number>((resolve, reject) =>
      this.server.bindAsync(
        `0.0.0.0:${this.config.GRPC_PORT}`,
        ServerCredentials.createInsecure(),
        (err, port) => (err ? reject(err) : resolve(port)),
      ),
    );
    this.started = true;
    this.logger.info({ port: this.port }, "grpc listening");
  }

  /** Stops accepting calls and lets in-flight ones finish, up to half the shutdown budget. */
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const graceMs = this.config.SHUTDOWN_TIMEOUT_MS / 2;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        this.logger.warn("grpc graceful shutdown timed out; cancelling in-flight calls");
        this.server.forceShutdown();
        resolve();
      }, graceMs);
      this.server.tryShutdown(() => {
        clearTimeout(force);
        resolve();
      });
    });
    this.logger.info("grpc stopped");
  }

  private adapt(definition: ServiceDefinition, instance: object): UntypedServiceImplementation {
    const impl: UntypedServiceImplementation = {};
    for (const [name, method] of Object.entries(definition)) {
      const handler = (instance as Record<string, unknown>)[name];
      if (method.requestStream || method.responseStream) {
        throw new Error(`${method.path}: streaming RPCs are not supported by GrpcServer`);
      }
      if (typeof handler !== "function") throw new Error(`${method.path}: no handler method "${name}"`);
      impl[name] = (call: ServerUnaryCall<unknown, unknown>, callback: sendUnaryData<unknown>) =>
        void this.invoke(method.path, (handler as UnaryHandler).bind(instance), call, callback);
    }
    return impl;
  }

  private async invoke(
    path: string,
    handler: UnaryHandler,
    call: ServerUnaryCall<unknown, unknown>,
    callback: sendUnaryData<unknown>,
  ): Promise<void> {
    const startedAt = performance.now();
    const { ctx, dispose } = contextFromCall(call);
    let code: status = status.OK;
    try {
      // Already late (queued behind other work): do nothing rather than half of something.
      if (ctx.remainingMs() === 0) {
        throw new DomainError(status.DEADLINE_EXCEEDED, "DEADLINE_EXCEEDED", "deadline exceeded");
      }
      const response = await handler(call.request, ctx);
      callback(null, response);
    } catch (err) {
      const { response, unexpected } = toGrpcError(err, this.config.SERVICE_NAME);
      code = response.code ?? status.UNKNOWN;
      if (unexpected) this.logger.error({ err, rpc: path }, "unhandled error in grpc handler");
      else this.logger.debug({ rpc: path, code, reason: (err as DomainError).reason }, "grpc call failed");
      callback(response);
    } finally {
      dispose();
      this.duration.record(performance.now() - startedAt, {
        "rpc.system": "grpc",
        "rpc.method": path,
        "rpc.grpc.status_code": code,
      });
    }
  }
}
