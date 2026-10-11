import { status } from "@grpc/grpc-js";
import { CreditReason, PlusPlan, PlusStatus } from "@kade/proto/kade/profile/v1/profile_service";
import { describe, expect, it } from "vitest";
import { DomainError } from "../platform/grpc/errors.js";
import { validateAddress } from "./address.grpc.js";
import { validateCreditChange } from "./credit-rules.js";
import { cardLabel, plusActive, plusRenewsAt, plusToProto, TRIAL_MS, type PlusRow } from "./plus.js";

const DAY = 86_400_000;

function reasonOf(fn: () => unknown): [status, string] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return [(e as DomainError).code, (e as DomainError).reason];
  }
  throw new Error("expected a DomainError");
}

describe("validateCreditChange", () => {
  const ok = (amountMinor: number, reason: CreditReason, orderId = "o1") =>
    expect(() => validateCreditChange({ amountMinor, reason, orderId })).not.toThrow();
  const bad = (amountMinor: number, reason: CreditReason, orderId = "o1") =>
    reasonOf(() => validateCreditChange({ amountMinor, reason, orderId }))[1];

  it("enforces the sign per reason", () => {
    ok(-500, CreditReason.CREDIT_REASON_ORDER_SPEND);
    ok(500, CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED);
    ok(500, CreditReason.CREDIT_REASON_GOODWILL, "");
    ok(-500, CreditReason.CREDIT_REASON_ADJUSTMENT, "");
    ok(500, CreditReason.CREDIT_REASON_ADJUSTMENT, "");
    expect(bad(500, CreditReason.CREDIT_REASON_ORDER_SPEND)).toBe("AMOUNT_SIGN_INVALID");
    expect(bad(-500, CreditReason.CREDIT_REASON_REFUND)).toBe("AMOUNT_SIGN_INVALID");
  });

  it("needs an order id for spends and their reversal, a reason and a non-zero amount", () => {
    expect(bad(-500, CreditReason.CREDIT_REASON_ORDER_SPEND, " ")).toBe("ORDER_ID_REQUIRED");
    expect(bad(500, CreditReason.CREDIT_REASON_ORDER_SPEND_REVERSED, "")).toBe("ORDER_ID_REQUIRED");
    expect(bad(500, CreditReason.CREDIT_REASON_UNSPECIFIED)).toBe("CREDIT_REASON_REQUIRED");
    expect(bad(0, CreditReason.CREDIT_REASON_GOODWILL)).toBe("AMOUNT_INVALID");
    expect(bad(1e12, CreditReason.CREDIT_REASON_GOODWILL)).toBe("AMOUNT_INVALID");
  });
});

describe("Plus", () => {
  const now = Date.UTC(2026, 9, 12);
  const member: PlusRow = {
    customerId: "c",
    status: PlusStatus.PLUS_STATUS_MEMBER,
    plan: PlusPlan.PLUS_PLAN_MONTHLY,
    joinedAt: new Date(now - 10 * DAY),
    trialEndsAt: new Date(now - 10 * DAY + TRIAL_MS),
    endsAt: null,
    cardId: "visa-4242",
    cardLabel: "Visa •••• 4242",
    priceMinor: 99_000,
    updatedAt: new Date(now),
  };

  it("renews at the end of the free month, then every period", () => {
    expect(plusRenewsAt(member, now)).toEqual(member.trialEndsAt);
    expect(plusRenewsAt(member, member.trialEndsAt.getTime() + DAY).getTime()).toBe(
      member.trialEndsAt.getTime() + 30 * DAY,
    );
    const yearly = { ...member, plan: PlusPlan.PLUS_PLAN_YEARLY };
    expect(plusRenewsAt(yearly, member.trialEndsAt.getTime() + DAY).getTime()).toBe(
      member.trialEndsAt.getTime() + 365 * DAY,
    );
  });

  it("stays active after cancelling until the paid period ends", () => {
    const cancelled = { ...member, status: PlusStatus.PLUS_STATUS_CANCELLED, endsAt: new Date(now + DAY) };
    expect(plusActive(member, now)).toBe(true);
    expect(plusActive(cancelled, now)).toBe(true);
    expect(plusActive(cancelled, now + 2 * DAY)).toBe(false);
    expect(plusActive(undefined, now)).toBe(false);
    expect(plusToProto(cancelled, now)).toMatchObject({ active: true, renewsAt: undefined });
    expect(plusToProto(undefined, now)).toMatchObject({ status: PlusStatus.PLUS_STATUS_NONE, active: false });
  });

  it("labels cards", () => {
    expect(cardLabel("visa-4242")).toBe("Visa •••• 4242");
    expect(cardLabel("mastercard-0002-1734")).toBe("Mastercard •••• 0002");
    expect(cardLabel("0199d3a0-0000-7000-8000-000000000001")).toBe("Saved card");
  });
});

describe("validateAddress", () => {
  const base = { id: "", label: " Home ", line: " 42 Galle Rd ", area: "Kollupitiya", note: "", zoneId: "" };

  it("trims and keeps the location", () => {
    expect(validateAddress({ ...base, location: { lat: 6.9, lng: 79.85 } })).toMatchObject({
      id: undefined,
      label: "Home",
      line: "42 Galle Rd",
      lat: 6.9,
      lng: 79.85,
    });
  });

  it.each([
    [undefined, "ADDRESS_REQUIRED"],
    [{ ...base, label: "" }, "ADDRESS_LABEL_REQUIRED"],
    [{ ...base, line: " " }, "ADDRESS_LINE_REQUIRED"],
    [{ ...base, id: "bad id!" }, "ADDRESS_ID_INVALID"],
    [{ ...base, location: { lat: 200, lng: 0 } }, "LOCATION_INVALID"],
  ])("rejects %o with %s", (address, reason) => {
    expect(reasonOf(() => validateAddress(address))).toEqual([status.INVALID_ARGUMENT, reason]);
  });
});
