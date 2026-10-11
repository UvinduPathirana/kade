import { Metadata, status, type CallOptions, type ClientUnaryCall, type ServiceError } from "@grpc/grpc-js";
import { setTimeout as sleep } from "node:timers/promises";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../platform/grpc/error-details.js";

/**
 * A failed call to another Kadé service: the gRPC status code plus the ErrorInfo reason the
 * dependency sent (e.g. PAYMENT_DECLINED). `retryable` = transient (unavailable, deadline); anything
 * else is the dependency's considered answer and retrying will not change it.
 */
export class DependencyError extends Error {
  override name = "DependencyError";
  constructor(
    readonly dependency: string,
    readonly code: status,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(`${dependency}: ${message}`);
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

const RETRYABLE = new Set<status>([
  status.UNAVAILABLE,
  status.DEADLINE_EXCEEDED,
  status.RESOURCE_EXHAUSTED,
  status.ABORTED,
  status.UNKNOWN,
  status.INTERNAL,
]);

type UnaryMethod<Req, Res> = (
  request: Req,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (error: ServiceError | null, response: Res) => void,
) => ClientUnaryCall;

export interface CallSettings {
  /** Per attempt. */
  deadlineMs: number;
  /** Extra attempts for idempotent reads only (CONVENTIONS: retries only for idempotent reads). */
  retries?: number;
  metadata?: Record<string, string>;
}

/** One unary call with a deadline, ErrorInfo decoding and (for reads) a couple of quick retries. */
export async function unary<Req, Res>(
  dependency: string,
  method: UnaryMethod<Req, Res>,
  request: Req,
  settings: CallSettings,
): Promise<Res> {
  const attempts = 1 + (settings.retries ?? 0);
  for (let attempt = 1; ; attempt++) {
    try {
      return await once(dependency, method, request, settings);
    } catch (err) {
      if (!(err instanceof DependencyError) || !err.retryable || attempt >= attempts) throw err;
      await sleep(100 * 3 ** (attempt - 1));
    }
  }
}

function once<Req, Res>(
  dependency: string,
  method: UnaryMethod<Req, Res>,
  request: Req,
  settings: CallSettings,
): Promise<Res> {
  // No x-user-id: services treat calls without a user as trusted service-to-service calls.
  const md = new Metadata();
  for (const [k, v] of Object.entries(settings.metadata ?? {})) md.set(k, v);
  return new Promise<Res>((resolve, reject) => {
    method(request, md, { deadline: Date.now() + settings.deadlineMs }, (err, res) => {
      if (err) reject(toDependencyError(dependency, err));
      else resolve(res);
    });
  });
}

export function toDependencyError(dependency: string, err: ServiceError): DependencyError {
  const raw = err.metadata?.get(STATUS_DETAILS_KEY)[0];
  let reason: string | undefined;
  if (raw && typeof raw !== "string") {
    try {
      reason = decodeErrorInfo(raw)?.reason;
    } catch {
      reason = undefined;
    }
  }
  return new DependencyError(dependency, err.code ?? status.UNKNOWN, reason, err.details || err.message);
}
