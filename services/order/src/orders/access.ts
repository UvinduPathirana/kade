import type { Order } from "@kade/proto/kade/order/v1/order_service";
import type { RequestContext } from "../platform/grpc/context.js";
import { notFound } from "../platform/grpc/errors.js";

const STAFF = ["ops", "admin", "support", "finance", "system"];
const MERCHANT = ["merchant_staff", "merchant_owner"];

export const isStaff = (ctx: RequestContext): boolean => STAFF.some((r) => ctx.hasRole(r));

/**
 * Who may see/act on an order, from the gateway's metadata (CONVENTIONS "Auth"). Calls without
 * x-user-id are service-to-service (support, review, gateways' system calls) and are trusted.
 * Not allowed reads as NOT_FOUND, so order ids can't be probed.
 */
export function canAccess(ctx: RequestContext, order: Order): boolean {
  if (!ctx.userId || isStaff(ctx)) return true;
  if (ctx.userId === order.customer?.id) return true;
  if (MERCHANT.some((r) => ctx.hasRole(r)) && (!ctx.outletId || ctx.outletId === order.restaurant?.id))
    return true;
  if (ctx.hasRole("rider") && order.rider?.riderId) return true;
  return false;
}

export function assertAccess(ctx: RequestContext, order: Order): void {
  if (!canAccess(ctx, order)) throw notFound("ORDER_NOT_FOUND", "We couldn't find that order.");
}
