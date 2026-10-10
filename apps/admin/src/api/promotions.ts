// Vouchers API. Later: the promotions service. The order service re-checks every code at checkout
// (apps/customer/src/api/promos.ts is the customer side of the same rules).
import { formatRs } from "@kade/ui";
import { ApiError, audit, find, respond } from "./client";
import { vouchers } from "./mock/backOffice";
import type { Voucher, VoucherStatus } from "./types";

export const listVouchers = () => respond(vouchers);

export type NewVoucher = Omit<Voucher, "uses" | "spent" | "status">;

export async function createVoucher(v: NewVoucher) {
  const code = v.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(code))
    throw new ApiError("Codes are 4 to 16 letters and numbers, with no spaces.");
  if (vouchers.some((x) => x.code === code))
    throw new ApiError(`${code} already exists. Choose another code.`);
  const status: VoucherStatus = v.startsOn > "2026-10-10" ? "scheduled" : "active";
  const created: Voucher = { ...v, code, uses: 0, spent: 0, status };
  vouchers.unshift(created);
  audit({
    action: "Created voucher",
    recordType: "voucher",
    recordId: code,
    detail: `${v.description}. Budget ${formatRs(v.budget)}`,
  });
  return respond(created);
}

export async function setVoucherStatus({ code, status }: { code: string; status: VoucherStatus }) {
  const v = find(vouchers, (x) => x.code === code, "Voucher");
  if (v.status === "ended")
    throw new ApiError("Ended vouchers can't be restarted. Create a new code instead.");
  v.status = status;
  const verb = { active: "Resumed", paused: "Paused", ended: "Ended", scheduled: "Scheduled" }[status];
  audit({ action: `${verb} voucher`, recordType: "voucher", recordId: code });
  return respond(v);
}
