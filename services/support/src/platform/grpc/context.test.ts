import { Metadata, status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import { createRequestContext } from "./context.js";
import { DomainError } from "./errors.js";

function md(entries: Record<string, string>): Metadata {
  const m = new Metadata();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

describe("createRequestContext", () => {
  it("reads identity metadata set by the gateways", () => {
    const ctx = createRequestContext({
      metadata: md({ "x-user-id": "u1", "x-roles": "merchant_staff, merchant_owner", "x-outlet-id": "o9" }),
    });
    expect(ctx).toMatchObject({ userId: "u1", roles: ["merchant_staff", "merchant_owner"], outletId: "o9" });
    expect(ctx.hasRole("merchant_owner")).toBe(true);
    expect(ctx.requireUser()).toBe("u1");
    expect(() => ctx.requireRole("ops", "merchant_owner")).not.toThrow();
  });

  it("throws UNAUTHENTICATED / PERMISSION_DENIED with stable reasons", () => {
    const anon = createRequestContext({ metadata: new Metadata() });
    expect(() => anon.requireUser()).toThrow(expect.objectContaining({ code: status.UNAUTHENTICATED }));
    try {
      anon.requireRole("ops");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect(err).toMatchObject({ code: status.PERMISSION_DENIED, reason: "PERMISSION_DENIED" });
    }
  });

  it("reports the time left before the deadline", () => {
    const none = createRequestContext({ metadata: new Metadata() });
    expect(none.remainingMs()).toBeUndefined();
    const soon = createRequestContext({ metadata: new Metadata(), deadline: new Date(Date.now() + 1_000) });
    expect(soon.remainingMs()).toBeGreaterThan(900);
    const past = createRequestContext({ metadata: new Metadata(), deadline: new Date(Date.now() - 5) });
    expect(past.remainingMs()).toBe(0);
  });
});
