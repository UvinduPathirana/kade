import { Metadata, status, type CallOptions, type ClientUnaryCall, type ServiceError } from "@grpc/grpc-js";
import type { RequestContext } from "./context.js";

/** The callback form of a generated ts-proto client method. */
export type UnaryMethod<Req, Res> = (
  request: Req,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (err: ServiceError | null, response: Res) => void,
) => ClientUnaryCall;

export interface UnaryOptions {
  /** The inbound call: its identity is forwarded and its deadline caps ours. */
  ctx?: RequestContext;
  /** Our own budget for this call (CONVENTIONS: default 2 s). */
  timeoutMs: number;
  /** Idempotent reads only: retry once on UNAVAILABLE while time remains. */
  retry?: boolean;
}

const FORWARDED = ["x-user-id", "x-roles", "x-outlet-id"];
/** Leave the caller a little time to turn our failure into a useful error. */
const RESERVE_MS = 50;
const MIN_RETRY_MS = 200;

/**
 * Calls a unary RPC with a deadline (never longer than the caller's own) and the caller's identity
 * metadata. traceparent is propagated by the gRPC OTel instrumentation.
 */
export async function callUnary<Req, Res>(
  method: UnaryMethod<Req, Res>,
  request: Req,
  options: UnaryOptions,
): Promise<Res> {
  const metadata = new Metadata();
  for (const key of FORWARDED) {
    const value = options.ctx?.metadata.get(key)[0];
    if (typeof value === "string" && value) metadata.set(key, value);
  }
  const callerLeft = options.ctx?.remainingMs();
  const budget = Math.min(options.timeoutMs, callerLeft === undefined ? Infinity : callerLeft - RESERVE_MS);
  const until = Date.now() + Math.max(1, budget);

  for (let attempt = 1; ; attempt++) {
    try {
      return await new Promise<Res>((resolve, reject) =>
        method(request, metadata, { deadline: until }, (err, res) => (err ? reject(err) : resolve(res))),
      );
    } catch (err) {
      const retryable =
        options.retry && attempt === 1 && isServiceError(err) && err.code === status.UNAVAILABLE;
      if (!retryable || until - Date.now() < MIN_RETRY_MS) throw err;
    }
  }
}

export function isServiceError(err: unknown): err is ServiceError {
  return err instanceof Error && typeof (err as { code?: unknown }).code === "number" && "metadata" in err;
}
