import { FraudFlagKind } from "@kade/proto/kade/profile/v1/profile_service";
import { formatRs } from "../shared/money.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface RiskRule {
  kind: FraudFlagKind;
  windowMs: number;
  threshold: number;
  describe(count: number, totalMinor: number): string;
}

/** The risk model: N signals of one kind inside a sliding window raises an open flag. */
export const RISK_RULES: Record<number, RiskRule> = {
  [FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS]: {
    kind: FraudFlagKind.FRAUD_FLAG_KIND_REFUNDS,
    windowMs: 7 * DAY,
    threshold: 3,
    describe: (n, total) => `${n} refunds in 7 days, ${formatRs(total)} refunded`,
  },
  [FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS]: {
    kind: FraudFlagKind.FRAUD_FLAG_KIND_CANCELLATIONS,
    windowMs: 30 * DAY,
    threshold: 3,
    describe: (n) => `${n} orders cancelled by the customer in 30 days`,
  },
  [FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES]: {
    kind: FraudFlagKind.FRAUD_FLAG_KIND_PAYMENT_FAILURES,
    windowMs: 2 * HOUR,
    threshold: 3,
    describe: (n) => `${n} cards declined in 2 hours`,
  },
};

/** Whether the signals in the window cross the rule's threshold. */
export function evaluate(rule: RiskRule, count: number, totalMinor: number): string | undefined {
  return count >= rule.threshold ? rule.describe(count, totalMinor) : undefined;
}
