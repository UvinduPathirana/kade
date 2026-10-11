import { status } from "@grpc/grpc-js";
import type { ServiceError } from "@grpc/grpc-js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "./grpc/error-details.js";

/** RFC 9457 problem details, the body of every error response (application/problem+json). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  /** User-facing message the apps can show as-is. */
  detail?: string;
  /** Stable machine code (the service's ErrorInfo reason), e.g. NOTE_NOT_FOUND. */
  code: string;
  instance?: string;
  traceId?: string;
}

// Copy for reasons whose service message isn't what the app should say. Everything else uses the
// service's message for 4xx and a generic line for 5xx.
// The customer app shows `detail` as-is, so these match the copy it used with mock data.
const USER_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in again.",
  IDEMPOTENCY_KEY_REUSED: "This request was already sent with different details. Please try again.",
  CART_EMPTY: "Your cart is empty. Add a dish before placing an order.",
  ADDRESS_REQUIRED: "Choose where to deliver.",
  OUT_OF_ZONE: "We don't deliver there yet. Kadé delivers in Colombo 01 to 15 and Dehiwala.",
  PRICE_CHANGED:
    "Prices changed while you were checking out. Check the new total and place your order again.",
  ORDER_ALREADY_STARTED: "The restaurant has already started on your order, so it can't be cancelled here.",
  CASH_TIP_AT_DOOR: "Cash tips are given to the rider at the door.",
  ISSUE_ALREADY_REPORTED:
    "You've already reported a problem with this order. Chat with us if something else is wrong.",
  ORDER_NOT_ARRIVED: "You can report a problem once the order has arrived.",
  CASH_ORDER_REFUND_TO_CREDIT: "This order was paid in cash, so the refund can only go to your Kadé credit.",
  GROUP_CLOSED: "This group order doesn't exist, or the host has closed it.",
  CUSTOMER_BLOCKED: "Your account can't place orders right now. Chat with us to sort it out.",
};

const GENERIC = "Something went wrong on our side. Please try again.";

// https://cloud.google.com/apis/design/errors#handling_errors (gRPC -> HTTP)
const HTTP_STATUS: Record<number, number> = {
  [status.INVALID_ARGUMENT]: 400,
  [status.FAILED_PRECONDITION]: 400,
  [status.OUT_OF_RANGE]: 400,
  [status.UNAUTHENTICATED]: 401,
  [status.PERMISSION_DENIED]: 403,
  [status.NOT_FOUND]: 404,
  [status.ALREADY_EXISTS]: 409,
  [status.ABORTED]: 409,
  [status.RESOURCE_EXHAUSTED]: 429,
  [status.CANCELLED]: 499,
  [status.UNIMPLEMENTED]: 501,
  [status.UNAVAILABLE]: 503,
  [status.DEADLINE_EXCEEDED]: 504,
};

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  429: "Too many requests",
  499: "Client closed request",
  500: "Internal error",
  501: "Not implemented",
  503: "Service unavailable",
  504: "Upstream timeout",
};

export function problem(
  httpStatus: number,
  code: string,
  detail: string | undefined,
  extra: Pick<Problem, "instance" | "traceId"> = {},
): Problem {
  return {
    type: `https://kade.lk/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: TITLES[httpStatus] ?? "Error",
    status: httpStatus,
    detail: USER_MESSAGES[code] ?? detail,
    code,
    ...extra,
  };
}

/** Maps an upstream gRPC failure to a problem, using the ErrorInfo reason when present. */
export function problemFromGrpc(
  err: ServiceError,
  extra: Pick<Problem, "instance" | "traceId"> = {},
): Problem {
  const httpStatus = HTTP_STATUS[err.code] ?? 500;
  const bin = err.metadata?.get(STATUS_DETAILS_KEY)[0];
  const info = bin instanceof Buffer ? decodeErrorInfo(bin) : undefined;
  const code = info?.reason || status[err.code] || "UNKNOWN";
  // 5xx details can contain internals (connection errors, stack fragments): never pass them on.
  const detail = httpStatus >= 500 ? GENERIC : err.details;
  return problem(httpStatus, code, detail, extra);
}
