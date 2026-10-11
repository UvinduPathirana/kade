// Group orders (order service) against the customer gateway.
import { ApiError, GroupError } from "../errors";
import { api, newIdempotencyKey } from "../http";
import type { GroupOrder } from "../types";

export interface CreateGroupInput {
  restaurantId: number;
  hostName: string;
  minutes: number;
  limit?: number;
}

const asGroupError = (err: unknown): never => {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401)
    throw new GroupError(err.message);
  throw err;
};

export const createGroup = (input: CreateGroupInput) =>
  api<GroupOrder>("POST", "/v1/groups", {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: { ...input, hostName: input.hostName.trim() || "You" },
  }).catch(asGroupError);

export const getGroup = (id: string) =>
  api<GroupOrder>("GET", `/v1/groups/${encodeURIComponent(id)}`).catch(asGroupError);
