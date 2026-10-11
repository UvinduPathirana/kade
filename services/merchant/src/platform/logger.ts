import type { LoggerService } from "@nestjs/common";
import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

export type { Logger } from "pino";

/** Nest injection token for the root pino logger. */
export const LOGGER = Symbol("LOGGER");

// JSON to stdout. trace_id/span_id are injected by @opentelemetry/instrumentation-pino whenever a
// span is active, and the same records are shipped to Loki over OTLP.
export function createLogger(config: Pick<Config, "SERVICE_NAME" | "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: config.SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}

/** Routes Nest's own log lines (module init, route mapping, errors) through pino. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, stack: trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}
