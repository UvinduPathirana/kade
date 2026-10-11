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

  // ---- profile-specific ----
  // Keycloak admin REST (demo-user lookup at startup, phone sign-in user provisioning + tokens).
  // Unset KEYCLOAK_URL = those features are off (phone verify fails UNAVAILABLE; demo seed is lazy).
  KEYCLOAK_URL: z.url().optional(),
  KEYCLOAK_REALM: z.string().min(1).default("kade"),
  KEYCLOAK_ADMIN_REALM: z.string().min(1).default("master"),
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default("admin-cli"),
  KEYCLOAK_ADMIN_USER: z.string().min(1).default("admin"),
  KEYCLOAK_ADMIN_PASSWORD: z.string().min(1).default("admin"),
  // Phone OTP. "dev": no SMS, every challenge's code is OTP_DEV_CODE. "sms": random code sent through
  // notification.SendNotification (NOTIFICATION_GRPC).
  OTP_MODE: z.enum(["dev", "sms"]).default("dev"),
  OTP_DEV_CODE: z
    .string()
    .regex(/^\d{6}$/, "six digits")
    .default("123456"),
  NOTIFICATION_GRPC: z.string().min(1).optional(),
  // SaveAddress resolves zone_id through pricing.ResolveZone when set.
  PRICING_GRPC: z.string().min(1).optional(),
  // Demo data (docs in README). "false" turns every seed off.
  SEED_DEMO_DATA: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Catalog's seed ids (CONVENTIONS: app restaurant N -> 00000000-0000-7000-8000-<N, 12 digits>).
  SEED_FAVOURITE_RESTAURANT_IDS: z
    .string()
    .default("00000000-0000-7000-8000-000000000002,00000000-0000-7000-8000-000000000012")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
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
      const shown =
        value === undefined
          ? "unset"
          : key.includes("URL") || key.includes("PASSWORD")
            ? "set"
            : JSON.stringify(value);
      return `  - ${key} (${shown}): ${i.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

/** Nest injection token for the validated Config. */
export const CONFIG = Symbol("CONFIG");
