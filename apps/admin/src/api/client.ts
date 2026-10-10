// Shared plumbing for the mock API: a short delay so loading states are real, deep copies so the UI
// never edits the mock store by accident, and the audit trail every write leaves behind.
import { simNow } from "./mock/clock";
import { auditLog } from "./mock/backOffice";
import { ME } from "./mock/partners";
import type { AuditEntry } from "./types";

export { DAY, HOUR, MIN, simNow, TODAY_START } from "./mock/clock";
export { ME } from "./mock/partners";

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export async function respond<T>(data: T, ms = 120): Promise<T> {
  await wait(ms);
  return structuredClone(data);
}

let auditSeq = 100;

/** Every change staff make is written to the audit log (identity service: POST /audit). */
export function audit(entry: Omit<AuditEntry, "id" | "at" | "actor">) {
  auditLog.unshift({ id: `A-${++auditSeq}`, at: simNow(), actor: ME.name, ...entry });
}

export function find<T>(xs: T[], pred: (x: T) => boolean, what: string): T {
  const x = xs.find(pred);
  if (!x) throw new ApiError(`${what} not found. Refresh the page and try again.`);
  return x;
}
