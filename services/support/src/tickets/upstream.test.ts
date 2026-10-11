import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import type { Config } from "../platform/config.js";
import { encodeStatus, STATUS_DETAILS_KEY } from "../platform/grpc/error-details.js";
import type { DomainError } from "../platform/grpc/errors.js";
import type { Logger } from "../platform/logger.js";
import { Upstream } from "./upstream.js";

const logger = { warn: () => undefined, error: () => undefined, debug: () => undefined } as unknown as Logger;
const upstream = new Upstream(
  { ORDER_GRPC: "localhost:1", PROFILE_GRPC: "localhost:1", GRPC_CLIENT_TIMEOUT_MS: 200 } as Config,
  logger,
);
const translate = (u: string, e: ServiceError) =>
  (upstream as unknown as { translate(u: string, e: ServiceError): DomainError }).translate(u, e);

function grpcError(code: status, reason?: string): ServiceError {
  const metadata = new Metadata();
  if (reason)
    metadata.set(STATUS_DETAILS_KEY, encodeStatus(code, "nope", { reason, domain: "order", metadata: {} }));
  return Object.assign(new Error("nope"), { code, details: "Refund too big", metadata }) as ServiceError;
}

describe("Upstream error translation", () => {
  it("says clearly that nothing was paid when order is unreachable", () => {
    for (const code of [status.UNAVAILABLE, status.DEADLINE_EXCEEDED, status.UNIMPLEMENTED]) {
      const err = translate("order", grpcError(code));
      expect(err).toMatchObject({ code: status.UNAVAILABLE, reason: "ORDER_SERVICE_UNAVAILABLE" });
      expect(err.message).toMatch(/nothing was refunded/);
    }
    expect(translate("profile", grpcError(status.UNAVAILABLE)).reason).toBe("PROFILE_SERVICE_UNAVAILABLE");
  });

  it("passes business reasons through", () => {
    expect(
      translate("order", grpcError(status.FAILED_PRECONDITION, "REFUND_EXCEEDS_REMAINING")),
    ).toMatchObject({
      code: status.FAILED_PRECONDITION,
      reason: "REFUND_EXCEEDS_REMAINING",
      message: "Refund too big",
    });
    expect(translate("order", grpcError(status.NOT_FOUND)).reason).toBe("ORDER_NOT_FOUND");
  });

  it("fails fast with a deadline when nothing listens", async () => {
    const started = Date.now();
    await expect(upstream.getOrder("o1")).rejects.toMatchObject({ reason: "ORDER_SERVICE_UNAVAILABLE" });
    expect(Date.now() - started).toBeLessThan(2_000);
    upstream.onApplicationShutdown();
  });
});
