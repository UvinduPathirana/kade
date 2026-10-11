// Earnings, cash held and payouts (ledger) and quests (dispatch) over gateway-rider.
import { enc, get } from "../http";
import type { CashBalance, EarningsSummary, Payout, Period, Quest } from "../types";

export const getEarnings = (period: Period) => get<EarningsSummary>(`/v1/earnings?period=${enc(period)}`);

/** Today's figures for the home screen. */
export const getTodaySummary = () =>
  get<{ amount: number; trips: number; onlineMinutes: number; tips: number }>("/v1/earnings/today");

export const getQuests = () => get<Quest[]>("/v1/quests");

export const getCashBalance = () => get<CashBalance>("/v1/cash");

export const listPayouts = () => get<Payout[]>("/v1/payouts");
