import { Metadata, status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import { createRequestContext } from "../platform/grpc/context.js";
import type { DomainError } from "../platform/grpc/errors.js";
import { requireOps, requireOutletAccess } from "./access.js";

const R1 = "00000000-0000-7000-8000-000000000001";
function ctx(headers: Record<string, string>) {
  const md = new Metadata();
  for (const [k, v] of Object.entries(headers)) md.set(k, v);
  return createRequestContext({ metadata: md });
}
const denied = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code === status.PERMISSION_DENIED ? (e as DomainError).reason : "other";
  }
  return undefined;
};

describe("requireOutletAccess", () => {
  it("trusts internal calls without a user", () =>
    expect(denied(() => requireOutletAccess(ctx({}), R1))).toBeUndefined());
  it("lets staff edit their own outlet only", () => {
    const staff = { "x-user-id": "u", "x-roles": "merchant_staff", "x-outlet-id": R1 };
    expect(denied(() => requireOutletAccess(ctx(staff), R1))).toBeUndefined();
    expect(denied(() => requireOutletAccess(ctx(staff), R1.replace(/1$/, "2")))).toBe("OUTLET_MISMATCH");
  });
  it("lets ops edit anything and refuses customers", () => {
    expect(
      denied(() => requireOutletAccess(ctx({ "x-user-id": "u", "x-roles": "ops" }), R1)),
    ).toBeUndefined();
    expect(denied(() => requireOutletAccess(ctx({ "x-user-id": "u", "x-roles": "customer" }), R1))).toBe(
      "PERMISSION_DENIED",
    );
  });
  it("keeps merchandising to ops and admin", () => {
    expect(denied(() => requireOps(ctx({ "x-user-id": "u", "x-roles": "merchant_owner" })))).toBe(
      "PERMISSION_DENIED",
    );
    expect(denied(() => requireOps(ctx({ "x-user-id": "u", "x-roles": "admin" })))).toBeUndefined();
  });
});
