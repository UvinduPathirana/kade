import type { Metadata, ServerUnaryCall } from "@grpc/grpc-js";
import { permissionDenied, unauthenticated } from "./errors.js";

/**
 * Who is calling and how long they will wait. Built from gRPC metadata that the gateways set after
 * validating the user's JWT (docs/backend/CONVENTIONS.md, "Auth"). Services sit on the internal
 * network and trust these headers; they authorise, they do not authenticate.
 */
export interface RequestContext {
  /** `x-user-id`; undefined for anonymous calls (e.g. public catalogue reads). */
  readonly userId: string | undefined;
  /** `x-roles`, comma-separated: customer, merchant_staff, merchant_owner, rider, ops, ... */
  readonly roles: readonly string[];
  /** `x-outlet-id` for merchant staff: the outlet whose data they may touch. */
  readonly outletId: string | undefined;
  /** Absolute deadline set by the caller, if any. */
  readonly deadline: Date | undefined;
  /** Aborts when the caller cancels or the deadline passes. Pass to anything that accepts one. */
  readonly signal: AbortSignal;
  /** Raw incoming metadata, for anything not covered above. */
  readonly metadata: Metadata;

  /** Milliseconds left before the deadline (0 when passed), undefined without a deadline. */
  remainingMs(): number | undefined;
  hasRole(role: string): boolean;
  /** Returns the user id or throws UNAUTHENTICATED. */
  requireUser(): string;
  /** Throws PERMISSION_DENIED unless the caller has at least one of the roles. */
  requireRole(...roles: string[]): void;
}

export interface CreateContextOptions {
  metadata: Metadata;
  deadline?: Date;
  signal?: AbortSignal;
}

export function createRequestContext({ metadata, deadline, signal }: CreateContextOptions): RequestContext {
  const first = (key: string): string | undefined => {
    const v = metadata.get(key)[0];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const roles = (first("x-roles") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const userId = first("x-user-id");

  return {
    userId,
    roles,
    outletId: first("x-outlet-id"),
    deadline,
    signal: signal ?? new AbortController().signal,
    metadata,
    remainingMs: () => (deadline ? Math.max(0, deadline.getTime() - Date.now()) : undefined),
    hasRole: (role) => roles.includes(role),
    requireUser() {
      if (!userId) throw unauthenticated("UNAUTHENTICATED", "Sign in to continue.");
      return userId;
    },
    requireRole(...wanted) {
      if (!wanted.some((r) => roles.includes(r))) {
        throw permissionDenied("PERMISSION_DENIED", "You do not have access to this.", {
          required: wanted.join(","),
        });
      }
    },
  };
}

/** Context for an incoming call, with cancellation + deadline wired to `signal`. */
export function contextFromCall(call: ServerUnaryCall<unknown, unknown>): {
  ctx: RequestContext;
  dispose: () => void;
} {
  const raw = call.getDeadline();
  const ms = raw instanceof Date ? raw.getTime() : raw;
  const deadline = Number.isFinite(ms) ? new Date(ms) : undefined;

  const controller = new AbortController();
  const onCancel = (): void => controller.abort(new Error("call cancelled by client"));
  call.once("cancelled", onCancel);
  let timer: NodeJS.Timeout | undefined;
  if (deadline) {
    timer = setTimeout(
      () => controller.abort(new Error("deadline exceeded")),
      Math.max(0, deadline.getTime() - Date.now()),
    );
  }
  return {
    ctx: createRequestContext({ metadata: call.metadata, deadline, signal: controller.signal }),
    dispose: () => {
      clearTimeout(timer);
      call.removeListener("cancelled", onCancel);
    },
  };
}
