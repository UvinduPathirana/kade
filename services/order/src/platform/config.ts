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
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// URL" }),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  KAFKA_BROKERS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean),
    ),
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
      // Never echo secrets back: DATABASE_URL carries a password.
      const shown = value === undefined ? "unset" : key.includes("URL") ? "set" : JSON.stringify(value);
      return `  - ${key} (${shown}): ${i.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Nest injection token for the validated Config. */
export const CONFIG = Symbol("CONFIG");
