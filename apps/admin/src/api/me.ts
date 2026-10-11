// The signed-in staff member. Mock mode keeps the demo's ops lead; live mode fills this in from the
// Keycloak token and then gateway-admin's /v1/me before the console renders.
import type { Role } from "./types";

export interface Me {
  /** Same id the staff list and ticket assignees use. */
  id: string;
  name: string;
  /** First name, for "Resolved by Dilini". */
  short: string;
  email: string;
  role: Role;
  /** Job title shown in the shell, e.g. "Ops lead". */
  title: string;
  /** Effective permission ids; empty in mock mode (everything allowed). */
  permissions: string[];
}

export const ME: Me = {
  id: "S-1",
  name: "Dilini Perera",
  short: "Dilini",
  email: "dilini@kade.lk",
  role: "ops",
  title: "Ops lead",
  permissions: [],
};

export function setMe(next: Partial<Me>): void {
  Object.assign(ME, next);
}
