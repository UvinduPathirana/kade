import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { CallContext } from "../grpc/call.js";
import type { Upstreams } from "../grpc/clients.js";

export interface RouteDeps {
  u: Upstreams;
  callContext: (req: FastifyRequest, reply: FastifyReply) => CallContext;
}

/** The outlet the caller works at; set by the outlet hook in app.ts for every staff route. */
export function outletOf(req: FastifyRequest): string {
  const id = req.identity?.outletId;
  if (!id) throw new Error("outlet not resolved for this route");
  return id;
}

/** Forwarded as the RPC's idempotency_key; generated when the app didn't send one. */
export function idempotencyKey(req: FastifyRequest): string {
  const h = req.headers["idempotency-key"];
  return (Array.isArray(h) ? h[0] : h) || randomUUID();
}

export const IdempotencyHeaders = Type.Object({
  "idempotency-key": Type.Optional(
    Type.String({ maxLength: 128, description: "Retry with the same key to get the original result." }),
  ),
});

/** Roles that may use the restaurant app at all. */
export const STAFF = ["merchant_staff", "merchant_owner"];
export const OWNER = ["merchant_owner"];

export const security = [{ bearer: [] }];
