import { Metadata, status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import { createRequestContext } from "../platform/grpc/context.js";
import { DomainError } from "../platform/grpc/errors.js";
import { assertCustomerAccess, requireCustomerId, requireStaff } from "./access.js";
import { formatRs, readMoney } from "./money.js";
import { pageResponse, readPage } from "./paging.js";
import { isPhonePlaceholderEmail, normalisePhone, phoneUsername } from "./phone.js";

const ctx = (userId?: string, roles?: string) => {
  const md = new Metadata();
  if (userId) md.set("x-user-id", userId);
  if (roles) md.set("x-roles", roles);
  return createRequestContext({ metadata: md });
};

const reason = (fn: () => unknown): [status, string] => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return [(e as DomainError).code, (e as DomainError).reason];
  }
  throw new Error("expected a DomainError");
};

describe("normalisePhone", () => {
  it.each([
    ["077 123 4567", "+94771234567"],
    ["77-123-4567", "+94771234567"],
    ["+94771234567", "+94771234567"],
    ["0094771234567", "+94771234567"],
    ["94771234567", "+94771234567"],
  ])("%s -> %s", (raw, e164) => expect(normalisePhone(raw)).toBe(e164));

  it.each(["011 234 5678", "12345", "", "+1 650 555 1234"])("rejects %s", (raw) =>
    expect(normalisePhone(raw)).toBeNull(),
  );

  it("derives the Keycloak username and spots placeholder emails", () => {
    expect(phoneUsername("+94771234567")).toBe("94771234567");
    expect(isPhonePlaceholderEmail("94771234567@phone.kade.test")).toBe(true);
    expect(isPhonePlaceholderEmail("dilini@kade.test")).toBe(false);
  });
});

describe("access", () => {
  it("lets a customer touch only their own account", () => {
    expect(() => assertCustomerAccess(ctx("u1", "customer"), "u1")).not.toThrow();
    expect(reason(() => assertCustomerAccess(ctx("u1", "customer"), "u2"))).toEqual([
      status.PERMISSION_DENIED,
      "NOT_YOUR_ACCOUNT",
    ]);
  });

  it("trusts staff and internal callers", () => {
    expect(() => assertCustomerAccess(ctx("s1", "support"), "u2")).not.toThrow();
    expect(() => assertCustomerAccess(ctx(), "u2")).not.toThrow();
    expect(() => requireStaff(ctx())).not.toThrow();
    expect(() => requireStaff(ctx("s1", "finance"))).not.toThrow();
    expect(reason(() => requireStaff(ctx("s1", "finance"), "admin"))).toEqual([
      status.PERMISSION_DENIED,
      "PERMISSION_DENIED",
    ]);
  });

  it("validates customer ids", () => {
    expect(requireCustomerId(" 00000000-0000-7000-8005-000000000001 ")).toBe(
      "00000000-0000-7000-8005-000000000001",
    );
    expect(reason(() => requireCustomerId(""))).toEqual([status.INVALID_ARGUMENT, "CUSTOMER_ID_REQUIRED"]);
    expect(reason(() => requireCustomerId("a b"))).toEqual([status.INVALID_ARGUMENT, "CUSTOMER_ID_REQUIRED"]);
  });
});

describe("money", () => {
  it("accepts LKR minor units and rejects other currencies", () => {
    expect(readMoney({ amountMinor: -500, currency: "LKR" }, "amount")).toBe(-500);
    expect(readMoney({ amountMinor: 1, currency: "" }, "amount")).toBe(1);
    expect(readMoney(undefined, "amount")).toBeUndefined();
    expect(reason(() => readMoney({ amountMinor: 1, currency: "USD" }, "amount"))).toEqual([
      status.INVALID_ARGUMENT,
      "CURRENCY_UNSUPPORTED",
    ]);
  });

  it("formats whole rupees", () => {
    expect(formatRs(115_000)).toBe("Rs 1,150");
    expect(formatRs(-785_000)).toBe("Rs 7,850");
  });
});

describe("paging", () => {
  it("round-trips offset tokens and stops at the end", () => {
    const first = readPage({ pageSize: 10, pageToken: "" });
    expect(first).toEqual({ limit: 10, offset: 0 });
    const res = pageResponse(first, 10, 25);
    const second = readPage({ pageSize: 10, pageToken: res.nextPageToken });
    expect(second).toEqual({ limit: 10, offset: 10 });
    expect(pageResponse({ limit: 10, offset: 20 }, 5, 25).nextPageToken).toBe("");
  });

  it("caps the page size and rejects junk tokens", () => {
    expect(readPage({ pageSize: 10_000, pageToken: "" }, 20, 100).limit).toBe(100);
    expect(readPage(undefined, 20).limit).toBe(20);
    expect(reason(() => readPage({ pageSize: 1, pageToken: "garbage" }))).toEqual([
      status.INVALID_ARGUMENT,
      "PAGE_TOKEN_INVALID",
    ]);
  });
});
