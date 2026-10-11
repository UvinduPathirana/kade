import { Metadata, status, type CallOptions, type ServiceError } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import { callUnary, type UnaryMethod } from "./client.js";
import { createRequestContext } from "./context.js";

const serviceError = (code: status): ServiceError =>
  Object.assign(new Error(status[code]), { code, details: "", metadata: new Metadata() });

function fake(results: (ServiceError | string)[]) {
  const seen: { metadata: Metadata; options: Partial<CallOptions> }[] = [];
  const method: UnaryMethod<string, string> = (_req, metadata, options, cb) => {
    seen.push({ metadata, options });
    const next = results.shift()!;
    setImmediate(() => (typeof next === "string" ? cb(null, next) : cb(next, "")));
    return {} as never;
  };
  return { method, seen };
}

describe("callUnary", () => {
  it("forwards identity and never outlives the caller's deadline", async () => {
    const md = new Metadata();
    md.set("x-user-id", "dilini");
    md.set("x-roles", "customer");
    md.set("authorization", "Bearer secret");
    const ctx = createRequestContext({ metadata: md, deadline: new Date(Date.now() + 500) });
    const { method, seen } = fake(["ok"]);
    await expect(callUnary(method, "req", { ctx, timeoutMs: 2_000 })).resolves.toBe("ok");
    expect(seen[0]!.metadata.get("x-user-id")).toEqual(["dilini"]);
    expect(seen[0]!.metadata.get("x-roles")).toEqual(["customer"]);
    expect(seen[0]!.metadata.get("authorization")).toEqual([]);
    const deadline = seen[0]!.options.deadline as number;
    expect(deadline - Date.now()).toBeLessThanOrEqual(500);
  });

  it("retries reads once on UNAVAILABLE, not other errors", async () => {
    const flaky = fake([serviceError(status.UNAVAILABLE), "ok"]);
    await expect(callUnary(flaky.method, "r", { timeoutMs: 2_000, retry: true })).resolves.toBe("ok");
    expect(flaky.seen).toHaveLength(2);

    const notFound = fake([serviceError(status.NOT_FOUND)]);
    await expect(callUnary(notFound.method, "r", { timeoutMs: 2_000, retry: true })).rejects.toMatchObject({
      code: status.NOT_FOUND,
    });

    const down = fake([serviceError(status.UNAVAILABLE), serviceError(status.UNAVAILABLE)]);
    await expect(callUnary(down.method, "r", { timeoutMs: 2_000, retry: true })).rejects.toMatchObject({
      code: status.UNAVAILABLE,
    });
    expect(down.seen).toHaveLength(2);
  });
});
