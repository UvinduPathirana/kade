import { FraudFlagKind } from "@kade/proto/kade/profile/v1/profile_service";
import { describe, expect, it } from "vitest";
import { evaluate, RISK_RULES } from "./rules.js";

describe("risk rules", () => {
  it("flags 3 refunds in 7 days with the amount", () => {
    const rule = RISK_RULES[FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS]!;
    expect(evaluate(rule, 2, 500_000)).toBeUndefined();
    expect(evaluate(rule, 3, 785_000)).toBe("3 refunds in 7 days, Rs 7,850 refunded");
    expect(rule.windowMs).toBe(7 * 86_400_000);
  });

  it("flags customer cancellations and card declines", () => {
    expect(evaluate(RISK_RULES[FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS]!, 3, 0)).toMatch(
      /3 orders cancelled/,
    );
    expect(evaluate(RISK_RULES[FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES]!, 4, 0)).toBe(
      "4 cards declined in 2 hours",
    );
  });
});
