// Finance API. Later: the payouts service (weekly restaurant batches, rider settlements, cash
// deposits matched against bank statements) and the order service's refunds ledger.
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, ME, respond } from "./client";
import { cashRecords, payoutBatches, riderSettlements } from "./mock/backOffice";
import { refunds, restaurantById } from "./mock/orders";
import { customers, riders } from "./mock/partners";
import type { CashRecord, PayoutBatch, Refund, RiderSettlement } from "./types";

export interface PayoutBatchView extends Omit<PayoutBatch, "lines"> {
  lines: (PayoutBatch["lines"][number] & { restaurantName: string; commissionRate: number; bank: string })[];
  totals: { gross: number; commission: number; adjustments: number; net: number; orders: number };
}

export async function listPayoutBatches(): Promise<PayoutBatchView[]> {
  return respond(
    payoutBatches.map((b) => {
      const lines = b.lines.map((l) => {
        const r = restaurantById(l.restaurantId);
        return { ...l, restaurantName: r.name, commissionRate: r.commission, bank: r.bank };
      });
      const sum = (k: "gross" | "commission" | "adjustments" | "net" | "orders") =>
        lines.reduce((s, l) => s + l[k], 0);
      return {
        ...b,
        lines,
        totals: {
          gross: sum("gross"),
          commission: sum("commission"),
          adjustments: sum("adjustments"),
          net: sum("net"),
          orders: sum("orders"),
        },
      };
    }),
  );
}

export async function approvePayoutBatch(id: string) {
  const b = find(payoutBatches, (x) => x.id === id, "Payout batch");
  if (b.status !== "draft") throw new ApiError("This batch is already approved.");
  b.status = "approved";
  b.approvedBy = ME.name;
  const net = b.lines.reduce((s, l) => s + l.net, 0);
  audit({
    action: `Approved payout batch, ${formatRs(net)}`,
    recordType: "payout",
    recordId: id,
    detail: `${b.lines.length} restaurants, week of ${b.week}`,
  });
  return respond(b);
}

export interface SettlementView extends RiderSettlement {
  riderName: string;
  /** Positive: Kadé pays the rider. Negative: the rider owes Kadé. */
  net: number;
}

export async function listRiderSettlements(): Promise<SettlementView[]> {
  return respond(
    riderSettlements.map((s) => ({
      ...s,
      riderName: riders.find((r) => r.id === s.riderId)!.name,
      net: s.earnings - s.cashHeld,
    })),
  );
}

export async function settleRider(riderId: string) {
  const s = find(riderSettlements, (x) => x.riderId === riderId, "Settlement");
  s.status = "settled";
  const net = s.earnings - s.cashHeld;
  audit({
    action: net >= 0 ? `Paid rider ${formatRs(net)}` : `Received ${formatRs(-net)} from rider`,
    recordType: "rider",
    recordId: riderId,
    detail: `Settlement for ${s.week}`,
  });
  return respond(s);
}

export interface CashView extends CashRecord {
  riderName: string;
  /** collected − deposited; positive means cash is missing. */
  difference: number | null;
  state: "matched" | "short" | "over" | "awaiting";
}

const cashView = (c: CashRecord): CashView => {
  const difference = c.deposited === null ? null : c.collected - c.deposited;
  return {
    ...c,
    riderName: riders.find((r) => r.id === c.riderId)!.name,
    difference,
    state:
      difference === null ? "awaiting" : difference === 0 ? "matched" : difference > 0 ? "short" : "over",
  };
};

export async function listCashRecords(): Promise<CashView[]> {
  return respond(cashRecords.map(cashView).sort((a, b) => b.date.localeCompare(a.date)));
}

export async function recordDeposit({
  id,
  amount,
  bankRef,
}: {
  id: string;
  amount: number;
  bankRef: string;
}) {
  const c = find(cashRecords, (x) => x.id === id, "Cash record");
  if (!bankRef.trim()) throw new ApiError("Enter the bank reference from the deposit slip.");
  c.deposited = amount;
  c.bankRef = bankRef.trim().toUpperCase();
  const rider = riders.find((r) => r.id === c.riderId);
  if (rider) rider.cashHeld = Math.max(0, rider.cashHeld - amount);
  audit({
    action: `Recorded cash deposit ${formatRs(amount)}`,
    recordType: "rider",
    recordId: c.riderId,
    detail: c.bankRef,
  });
  return respond(cashView(c));
}

export interface RefundView extends Refund {
  customerName: string;
}

export async function listRefunds(): Promise<RefundView[]> {
  return respond(
    refunds.map((r) => ({
      ...r,
      customerName: customers.find((c) => c.id === r.customerId)?.name ?? "Unknown",
    })),
  );
}
