import type { FastifyReply, FastifyRequest } from "fastify";
import type { Identity } from "../auth.js";
import type { Config } from "../config.js";
import type { CallContext } from "../grpc/call.js";
import type { Upstreams } from "../grpc/clients.js";
import { restaurantUuid } from "../mappers/ids.js";

/** What every route plugin gets. */
export interface RouteDeps {
  up: Upstreams;
  config: Config;
  callContext: (req: FastifyRequest, reply: FastifyReply, deadlineMs?: number) => CallContext;
}

/** An error the error handler turns into a 4xx problem with this code and (user-facing) detail. */
export function httpError(statusCode: number, code: string, detail: string): Error {
  return Object.assign(new Error(detail), { statusCode, code });
}

export function requireIdentity(req: FastifyRequest): Identity {
  if (!req.identity) throw httpError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return req.identity;
}

/** The app's restaurant number -> catalog UUID, or a 404 problem. */
export function restaurantIdOr404(n: number): string {
  const id = restaurantUuid(n);
  if (!id) throw httpError(404, "RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");
  return id;
}

export const idempotencyKey = (req: FastifyRequest, fallback: string): string => {
  const h = req.headers["idempotency-key"];
  return (typeof h === "string" && h) || fallback;
};

export const bearer = [{ bearer: [] }];
