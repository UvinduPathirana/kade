import { z } from "zod";

// Variable names follow docs/backend/CONVENTIONS.md ("Environment variables"). Add service-specific
// variables (e.g. CATALOG_GRPC, REDIS_URL) here so a misconfigured container fails at boot, not
// on the first request that needs them.
// 0 = any free port (tests).
const port = z.coerce.number().int().min(0).max(65_535);

const schema = z.object({
  SERVICE_NAME: z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  GRPC_PORT: port,
  HTTP_PORT: port,
  REDIS_URL: z.url({ protocol: /^rediss?$/, error: "must be a redis:// URL" }),
  // Carts expire this long after the last write (7 days).
  CART_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
  // Dependencies (host:port). Every call gets a deadline of at most DOWNSTREAM_DEADLINE_MS.
  CATALOG_GRPC: z.string().min(1),
  PRICING_GRPC: z.string().min(1),
  PROMOTION_GRPC: z.string().min(1),
  PROFILE_GRPC: z.string().min(1),
  DOWNSTREAM_DEADLINE_MS: z.coerce.number().int().positive().default(2_000),
  // Unset = no OTLP export (traces/logs stay local, /metrics still works). Read by instrumentation.ts.
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const key = i.path.join(".");
      const value = env[key];
      // Never echo secrets back: URLs can carry passwords.
      const shown = value === undefined ? "unset" : key.includes("URL") ? "set" : JSON.stringify(value);
      return `  - ${key} (${shown}): ${i.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Nest injection token for the validated Config. */
export const CONFIG = Symbol("CONFIG");
