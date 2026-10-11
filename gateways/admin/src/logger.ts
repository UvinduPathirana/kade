import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

// Same shape as the services' logs: JSON, ISO time, level label; trace_id added by OTel.
export function createLogger(config: Pick<Config, "SERVICE_NAME" | "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: config.SERVICE_NAME },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    // Never log credentials that pass through the edge.
    redact: ["req.headers.authorization", "req.headers.cookie"],
  });
}
