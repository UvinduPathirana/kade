import type { RequestContext } from "../platform/grpc/context.js";
import { permissionDenied } from "../platform/grpc/errors.js";

/** Nest token for the service clock (real time, or DEMO_TIME). */
export const CLOCK = Symbol("CLOCK");
export type Clock = () => Date;

const STAFF = ["merchant_staff", "merchant_owner"];
const OPS = ["ops", "admin"];

/**
 * Calls without x-user-id come from other services on the internal network (merchant creating a
 * restaurant, order validating a cart) and are trusted. User calls arrive via a gateway: merchant
 * staff may only touch their own outlet (x-outlet-id); ops/admin may touch any.
 */
export function requireOutletAccess(ctx: RequestContext | undefined, restaurantId: string): void {
  if (!ctx?.userId) return;
  if (OPS.some((r) => ctx.hasRole(r))) return;
  if (STAFF.some((r) => ctx.hasRole(r))) {
    if (ctx.outletId && ctx.outletId.toLowerCase() === restaurantId) return;
    throw permissionDenied("OUTLET_MISMATCH", "You can only change your own restaurant.", {
      restaurant_id: restaurantId,
    });
  }
  ctx.requireRole(...STAFF, ...OPS);
}

/** Merchandising and restaurant creation: ops/admin (or an internal service). */
export function requireOps(ctx: RequestContext | undefined): void {
  if (!ctx?.userId) return;
  ctx.requireRole(...OPS);
}
