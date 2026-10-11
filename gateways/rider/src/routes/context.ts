import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import type { CallContext } from "../grpc/call.js";
import type { Upstreams } from "../grpc/clients.js";

export interface RouteDeps {
  u: Upstreams;
  callContext: (req: FastifyRequest, reply: FastifyReply) => CallContext;
}

/** The caller's dispatch rider id; set by the rider hook in app.ts for every rider route. */
export function riderOf(req: FastifyRequest): string {
  const id = req.identity?.riderId;
  if (!id) throw new Error("rider not resolved for this route");
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

/** Roles that may use the rider app's signed-in screens. */
export const RIDER = ["rider"];

export const security = [{ bearer: [] }];
