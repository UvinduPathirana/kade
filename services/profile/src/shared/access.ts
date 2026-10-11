import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, permissionDenied } from "../platform/grpc/errors.js";

/** Kadé staff roles (admin console). Any of them may read and act on any customer. */
export const STAFF_ROLES = ["ops", "support", "finance", "admin"] as const;

export const isStaff = (ctx: RequestContext): boolean => STAFF_ROLES.some((r) => ctx.hasRole(r));

/**
 * Internal callers (the order saga, other services) call without x-user-id: services trust the
 * internal network (CONVENTIONS "Auth"). Gateways always set x-user-id for end users.
 */
export const isInternal = (ctx: RequestContext): boolean => ctx.userId === undefined;

/**
 * "Me" RPCs carry customer_id explicitly. A signed-in customer may only touch their own account;
 * staff and internal callers may touch any.
 */
export function assertCustomerAccess(ctx: RequestContext, customerId: string): void {
  if (isInternal(ctx) || isStaff(ctx)) return;
  if (ctx.userId !== customerId) {
    throw permissionDenied("NOT_YOUR_ACCOUNT", "You can only change your own account.", { customerId });
  }
}

/** Staff-only RPCs (admin console). Internal callers are trusted too. */
export function requireStaff(ctx: RequestContext, ...roles: string[]): void {
  if (isInternal(ctx)) return;
  ctx.requireRole(...(roles.length ? roles : STAFF_ROLES));
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;

/** Customer ids are Keycloak subjects (UUIDs today); accept any reasonable opaque id. */
export function requireCustomerId(id: string, field = "customer_id"): string {
  const v = id.trim();
  if (!ID.test(v)) throw invalidArgument("CUSTOMER_ID_REQUIRED", "customer_id is required.", { field });
  return v;
}

export function requireId(id: string, field: string, reason: string): string {
  const v = id.trim();
  if (!ID.test(v)) throw invalidArgument(reason, `${field} is required.`, { field });
  return v;
}
