import { credentials } from "@grpc/grpc-js";
import { TemplateServiceClient } from "@kade/proto/kade/template/v1/template";

// Retries only for idempotent reads (CONVENTIONS, "Synchronous calls"). grpc-js applies this
// service config per method; mutating RPCs are never retried here, the app retries them with
// the same Idempotency-Key instead.
const serviceConfig = (service: string, idempotentMethods: string[]) =>
  JSON.stringify({
    methodConfig: [
      {
        name: idempotentMethods.map((method) => ({ service, method })),
        retryPolicy: {
          maxAttempts: 3,
          initialBackoff: "0.1s",
          maxBackoff: "1s",
          backoffMultiplier: 2,
          retryableStatusCodes: ["UNAVAILABLE"],
        },
      },
    ],
  });

/** One long-lived channel per upstream; grpc-js reconnects and load-balances underneath. */
export function createTemplateClient(address: string): TemplateServiceClient {
  return new TemplateServiceClient(address, credentials.createInsecure(), {
    "grpc.service_config": serviceConfig("kade.template.v1.TemplateService", ["GetNote"]),
    "grpc.keepalive_time_ms": 30_000,
  });
}
