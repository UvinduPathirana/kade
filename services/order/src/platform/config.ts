import { z } from "zod";

// Variable names follow docs/backend/CONVENTIONS.md ("Environment variables"). Add service-specific
// variables (e.g. CATALOG_GRPC, REDIS_URL) here so a misconfigured container fails at boot, not
// on the first request that needs them.
// 0 = any free port (tests).
const port = z.coerce.number().int().min(0).max(65_535);

const mode = z.enum(["grpc", "stub"]).default("grpc");
const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

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

  // ---- order: Temporal (namespace kade, task queue "order"; worker runs in this process) ----
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("kade"),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default("order"),
  // false = this process only serves gRPC/consumers and signals workflows run by another worker.
  TEMPORAL_WORKER: bool.default(true),
  // How long the kitchen has to accept before the order is REJECTED (TIMEOUT). 3 minutes by contract.
  ACCEPT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(180),
  // PlaceOrder waits this long for the saga to reach PLACED/SCHEDULED/FAILED before answering PENDING.
  PLACE_ORDER_WAIT_MS: z.coerce.number().int().positive().default(20_000),
  // Deadline on every outgoing gRPC call (CONVENTIONS: default 2 s).
  GRPC_CLIENT_DEADLINE_MS: z.coerce.number().int().positive().default(2_000),

  // Insert dilini's demo order history (KD-4821 …) on start. Compose turns it on; tests leave it off.
  SEED_DEMO_ORDERS: bool.default(false),

  // ---- order: dependencies. <NAME>_MODE=grpc (default) calls the service; stub answers in-process so
  // the saga runs end to end before that service exists. See README "Dependency modes". ----
  CATALOG_GRPC: z.string().min(1).default("localhost:50101"),
  PROFILE_GRPC: z.string().min(1).default("localhost:50103"),
  PRICING_GRPC: z.string().min(1).default("localhost:50105"),
  PROMOTION_GRPC: z.string().min(1).default("localhost:50106"),
  PAYMENT_GRPC: z.string().min(1).default("localhost:50108"),
  CATALOG_MODE: mode,
  PROFILE_MODE: mode,
  PRICING_MODE: mode,
  PROMOTION_MODE: mode,
  PAYMENT_MODE: mode,
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
