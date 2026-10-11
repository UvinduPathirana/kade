// Order API against the customer gateway (order, review and support services behind it).
import { ApiError, OrderError, PaymentDeclinedError } from "../errors";
import { api, newIdempotencyKey } from "../http";
import type { IssueInput, Order, OrderRating, PlaceOrderInput } from "../types";

/** Problems the person can act on become OrderError (shown as-is); outages stay generic. */
function asOrderError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.code === "PAYMENT_DECLINED") throw new PaymentDeclinedError(err.message);
    if (err.status === 404) throw new OrderError("This order doesn't exist.");
    if (err.status >= 400 && err.status < 500 && err.status !== 401) throw new OrderError(err.message);
  }
  throw err;
}

const path = (id: string) => `/v1/orders/${encodeURIComponent(id)}`;

export const placeOrder = (input: PlaceOrderInput) =>
  api<Order>("POST", "/v1/orders", {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: {
      mode: input.mode,
      restaurant: input.restaurant,
      lines: input.lines,
      address: input.address,
      riderNote: input.riderNote,
      scheduledFor: input.scheduledFor,
      payment: input.payment,
      promoCode: input.promoCode,
      tip: input.tip,
      useCredit: input.useCredit,
      substitution: input.substitution,
      groupId: input.groupId,
    },
  }).catch(asOrderError);

export const getOrder = (id: string) => api<Order>("GET", path(id), { auth: "required" }).catch(asOrderError);

export const listOrders = () => api<Order[]>("GET", "/v1/orders", { auth: "required" });

export const getActiveOrder = async (): Promise<Order | null> =>
  (await api<{ order: Order | null }>("GET", "/v1/orders/active", { auth: "required" })).order;

export const cancelOrder = (id: string) =>
  api<Order>("POST", `${path(id)}/cancel`, { auth: "required", idempotencyKey: newIdempotencyKey() }).catch(
    asOrderError,
  );

export const markCollected = (id: string) =>
  api<Order>("POST", `${path(id)}/collected`, {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
  }).catch(asOrderError);

export const updateTip = (id: string, tip: number) =>
  api<Order>("PUT", `${path(id)}/tip`, {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: { tip },
  }).catch(asOrderError);

export const rateOrder = (id: string, rating: Omit<OrderRating, "ratedAt">) =>
  api<Order>("POST", `${path(id)}/rating`, {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: {
      riderStars: rating.riderStars,
      riderTags: rating.riderTags,
      dishes: rating.dishes,
      comment: rating.comment,
    },
  }).catch(asOrderError);

export const reportIssue = (id: string, input: IssueInput) =>
  api<Order>("POST", `${path(id)}/issues`, {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: input,
  }).catch(asOrderError);
