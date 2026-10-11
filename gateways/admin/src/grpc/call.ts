import { Metadata, type CallOptions, type ClientUnaryCall, type ServiceError } from "@grpc/grpc-js";
import type { Identity } from "../auth.js";

/** The (request, metadata, options, callback) overload every ts-proto client method has. */
type UnaryMethod<Req, Res> = (
  request: Req,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (err: ServiceError | null, response: Res) => void,
) => ClientUnaryCall;

export interface CallContext {
  identity: Identity | undefined;
  /** Every call has a deadline (CONVENTIONS: default 2 s). */
  deadlineMs: number;
  /** Aborts the upstream call, e.g. when the HTTP client disconnects. */
  signal?: AbortSignal;
}

/**
 * Promise wrapper for a unary call that attaches the caller's identity as metadata and a deadline.
 * Trace context (traceparent) is added by the OTel gRPC instrumentation.
 *
 *   const res = await unary(client.getNote.bind(client), { id }, callContext(request));
 */
export function unary<Req, Res>(method: UnaryMethod<Req, Res>, request: Req, ctx: CallContext): Promise<Res> {
  return new Promise((resolve, reject) => {
    const call = method(
      request,
      identityMetadata(ctx.identity),
      { deadline: Date.now() + ctx.deadlineMs },
      (err, res) => {
        ctx.signal?.removeEventListener("abort", cancel);
        if (err) reject(err);
        else resolve(res);
      },
    );
    const cancel = (): void => call.cancel();
    ctx.signal?.addEventListener("abort", cancel, { once: true });
  });
}

export function identityMetadata(identity: Identity | undefined): Metadata {
  const md = new Metadata();
  if (identity) {
    md.set("x-user-id", identity.userId);
    md.set("x-roles", identity.roles.join(","));
    if (identity.outletId) md.set("x-outlet-id", identity.outletId);
  }
  return md;
}

export function isServiceError(err: unknown): err is ServiceError {
  return err instanceof Error && typeof (err as ServiceError).code === "number" && "metadata" in err;
}
