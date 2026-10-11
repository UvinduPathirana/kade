import { status } from "@grpc/grpc-js";
import {
  OutletStaffRole,
  type OutletStaffServiceClient,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import type { Logger } from "pino";
import type { Identity } from "./auth.js";
import type { Config } from "./config.js";
import { isServiceError, unary } from "./grpc/call.js";

export interface StaffOutlet {
  outletId: string;
  outletName: string;
  /** The person's role at the outlet (merchant), when known. */
  role?: "owner" | "manager" | "kitchen";
}

export class NotOutletStaffError extends Error {
  override name = "NotOutletStaffError";
}

const ROLES: Record<number, StaffOutlet["role"]> = {
  [OutletStaffRole.OUTLET_STAFF_ROLE_OWNER]: "owner",
  [OutletStaffRole.OUTLET_STAFF_ROLE_MANAGER]: "manager",
  [OutletStaffRole.OUTLET_STAFF_ROLE_KITCHEN]: "kitchen",
};

// Upstream failures that mean "merchant can't answer right now", not "you have no outlet".
const UNAVAILABLE = new Set<number>([status.UNAVAILABLE, status.UNIMPLEMENTED, status.DEADLINE_EXCEEDED]);

const HIT_TTL_MS = 5 * 60_000;
// Fallback answers (env mappings) are re-checked soon, so the real one wins once merchant is up.
const FALLBACK_TTL_MS = 30_000;

/**
 * Which outlet the signed-in staff member works at, sent to services as x-outlet-id.
 * Order: the token's outlet_id claim, merchant OutletStaffService.GetMyOutlets (first outlet),
 * then the STAFF_OUTLETS / DEFAULT_OUTLET_ID fallbacks for local development.
 */
export function createOutletResolver(deps: {
  config: Pick<Config, "STAFF_OUTLETS" | "DEFAULT_OUTLET_ID" | "GRPC_DEADLINE_MS">;
  staff: OutletStaffServiceClient;
  logger: Logger;
}) {
  const { config, staff, logger } = deps;
  const cache = new Map<string, { value: StaffOutlet; expires: number }>();

  const fallback = (identity: Identity): StaffOutlet | undefined => {
    const mapped =
      config.STAFF_OUTLETS[identity.userId] ??
      (identity.username ? config.STAFF_OUTLETS[identity.username] : undefined);
    const outletId = mapped ?? (config.DEFAULT_OUTLET_ID || undefined);
    return outletId ? { outletId, outletName: "" } : undefined;
  };

  return async function resolveOutlet(identity: Identity): Promise<StaffOutlet> {
    if (identity.outletId) return { outletId: identity.outletId, outletName: "" };
    const hit = cache.get(identity.userId);
    if (hit && hit.expires > Date.now()) return hit.value;

    let found: StaffOutlet | undefined;
    let ttl = HIT_TTL_MS;
    try {
      const res = await unary(
        staff.getMyOutlets.bind(staff),
        {},
        {
          identity,
          deadlineMs: config.GRPC_DEADLINE_MS,
        },
      );
      const first = res.outlets[0];
      if (first) found = { outletId: first.outletId, outletName: first.outletName, role: ROLES[first.role] };
    } catch (err) {
      if (!isServiceError(err) || !UNAVAILABLE.has(err.code)) throw err;
      logger.debug({ code: err.code }, "GetMyOutlets unavailable; using outlet fallbacks");
    }
    if (!found) {
      found = fallback(identity);
      ttl = FALLBACK_TTL_MS;
    }
    if (!found) throw new NotOutletStaffError("no outlet for this user");
    cache.set(identity.userId, { value: found, expires: Date.now() + ttl });
    return found;
  };
}

export type OutletResolver = ReturnType<typeof createOutletResolver>;
