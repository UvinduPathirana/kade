// Sales and weekly statements over gateway-merchant (ledger RestaurantFinanceService).
import { enc, get } from "../http";
import type { DailySales, Statement } from "../types";

export const getSales = (from: string, to: string) =>
  get<DailySales[]>(`/v1/sales?from=${enc(from)}&to=${enc(to)}`);

export const listStatements = () => get<Statement[]>("/v1/statements");

export const statementCsv = (s: Statement) => get<string>(`/v1/statements/${enc(s.id)}/csv`, { text: true });
