import { status } from "@grpc/grpc-js";
import { DependencyError } from "../clients/grpc-call.js";
import { DomainError } from "../platform/grpc/errors.js";

/**
 * A dependency's error as one of ours: its considered answers (FAILED_PRECONDITION reason
 * CREDIT_INSUFFICIENT…) pass through with their reason; outages become UNAVAILABLE so gateways show
 * "try again" instead of a 500.
 */
export function asDomainError(err: unknown, fallbackMessage: string): unknown {
  if (!(err instanceof DependencyError)) return err;
  if (err.retryable) {
    return new DomainError(
      status.UNAVAILABLE,
      `${err.dependency.toUpperCase()}_UNAVAILABLE`,
      fallbackMessage,
      {
        dependency: err.dependency,
      },
    );
  }
  return new DomainError(err.code, err.reason ?? `${err.dependency.toUpperCase()}_ERROR`, fallbackMessage, {
    dependency: err.dependency,
  });
}
