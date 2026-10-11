import { status } from "@grpc/grpc-js";
import type { RiderServiceClient } from "@kade/proto/kade/dispatch/v1/dispatch_service";
import type { Logger } from "pino";
import type { Identity } from "./auth.js";
import type { Config } from "./config.js";
import { isServiceError, unary } from "./grpc/call.js";

export class NotARiderError extends Error {
  override name = "NotARiderError";
}

// Upstream failures that mean "dispatch can't answer right now", not "you are not a rider".
const UNAVAILABLE = new Set<number>([status.UNAVAILABLE, status.UNIMPLEMENTED, status.DEADLINE_EXCEEDED]);
const HIT_TTL_MS = 10 * 60_000;
// Fallback answers (env mappings) are re-checked soon, so the real one wins once dispatch is up.
const FALLBACK_TTL_MS = 30_000;

/**
 * The dispatch rider id of the signed-in user (rider_id is not the Keycloak sub; riders link to
 * users by user_id). Order: dispatch RiderService.GetMyRider, then the RIDER_IDS / DEFAULT_RIDER_ID
 * fallbacks for local development.
 */
export function createRiderResolver(deps: {
  config: Pick<Config, "RIDER_IDS" | "DEFAULT_RIDER_ID" | "GRPC_DEADLINE_MS">;
  riders: RiderServiceClient;
  logger: Logger;
}) {
  const { config, riders, logger } = deps;
  const cache = new Map<string, { riderId: string; expires: number }>();

  const fallback = (identity: Identity): string | undefined =>
    config.RIDER_IDS[identity.userId] ??
    (identity.username ? config.RIDER_IDS[identity.username] : undefined) ??
    (config.DEFAULT_RIDER_ID || undefined);

  return async function resolveRider(identity: Identity): Promise<string> {
    if (identity.riderId) return identity.riderId;
    const hit = cache.get(identity.userId);
    if (hit && hit.expires > Date.now()) return hit.riderId;

    let riderId: string | undefined;
    let ttl = HIT_TTL_MS;
    try {
      const res = await unary(
        riders.getMyRider.bind(riders),
        {},
        {
          identity,
          deadlineMs: config.GRPC_DEADLINE_MS,
        },
      );
      riderId = res.rider?.id || undefined;
    } catch (err) {
      const notFound = isServiceError(err) && err.code === status.NOT_FOUND;
      if (!notFound && (!isServiceError(err) || !UNAVAILABLE.has(err.code))) throw err;
      if (!notFound)
        logger.debug({ code: (err as { code: number }).code }, "GetMyRider unavailable; using fallbacks");
    }
    if (!riderId) {
      riderId = fallback(identity);
      ttl = FALLBACK_TTL_MS;
    }
    if (!riderId) throw new NotARiderError("no rider for this user");
    cache.set(identity.userId, { riderId, expires: Date.now() + ttl });
    return riderId;
  };
}

export type RiderResolver = ReturnType<typeof createRiderResolver>;
