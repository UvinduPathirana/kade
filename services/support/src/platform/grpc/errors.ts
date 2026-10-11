import { Metadata, status, type ServerErrorResponse } from "@grpc/grpc-js";
import { encodeStatus, STATUS_DETAILS_KEY } from "./error-details.js";

/**
 * An expected failure with a stable reason. Throw these from handlers (or anything they call);
 * the gRPC layer turns them into status code + google.rpc.ErrorInfo. The message should be safe
 * to show a user: gateways fall back to it when they have no copy for the reason.
 */
export class DomainError extends Error {
  override name = "DomainError";
  constructor(
    readonly code: status,
    readonly reason: string,
    message: string,
    readonly metadata: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Factory = (reason: string, message: string, metadata?: Record<string, string>) => DomainError;
const factory =
  (code: status): Factory =>
  (reason, message, metadata) =>
    new DomainError(code, reason, message, metadata);

export const invalidArgument = factory(status.INVALID_ARGUMENT);
export const notFound = factory(status.NOT_FOUND);
export const alreadyExists = factory(status.ALREADY_EXISTS);
/** The request is valid but the system is not in a state to accept it (sold out, closed, key reused). */
export const failedPrecondition = factory(status.FAILED_PRECONDITION);
/** Concurrency conflict the client may retry (optimistic lock lost). */
export const aborted = factory(status.ABORTED);
export const permissionDenied = factory(status.PERMISSION_DENIED);
export const unauthenticated = factory(status.UNAUTHENTICATED);
export const resourceExhausted = factory(status.RESOURCE_EXHAUSTED);

const PG_QUERY_CANCELED = "57014"; // statement_timeout fired (we set it from the gRPC deadline)

export interface MappedError {
  response: ServerErrorResponse;
  /** Unexpected errors are logged with a stack; expected DomainErrors are not noise. */
  unexpected: boolean;
}

/** Turns anything a handler threw into a gRPC status with ErrorInfo. */
export function toGrpcError(err: unknown, domain: string): MappedError {
  if (err instanceof DomainError) {
    return { response: build(err.code, err.message, err.reason, domain, err.metadata), unexpected: false };
  }
  if (pgCode(err) === PG_QUERY_CANCELED) {
    return {
      response: build(status.DEADLINE_EXCEEDED, "deadline exceeded", "DEADLINE_EXCEEDED", domain, {}),
      unexpected: false,
    };
  }
  // Never leak internals (SQL, stack) to callers; the trace and log carry the detail.
  return { response: build(status.INTERNAL, "internal error", "INTERNAL", domain, {}), unexpected: true };
}

function build(
  code: status,
  message: string,
  reason: string,
  domain: string,
  metadata: Record<string, string>,
): ServerErrorResponse {
  const trailers = new Metadata();
  trailers.set(STATUS_DETAILS_KEY, encodeStatus(code, message, { reason, domain, metadata }));
  return Object.assign(new Error(message), { code, details: message, metadata: trailers });
}

// Drizzle wraps driver errors (DrizzleQueryError.cause), so walk the cause chain.
function pgCode(err: unknown): string | undefined {
  for (let e = err, depth = 0; e && typeof e === "object" && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
