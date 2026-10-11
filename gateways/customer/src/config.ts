import { z } from "zod";

const list = z.string().transform((s) =>
  s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);
// host:port of an upstream gRPC service (CONVENTIONS: <NAME>_GRPC=catalog:50101)
const grpcAddress = z.string().regex(/^[\w.-]+:\d+$/, "expected host:port");

const schema = z
  .object({
    SERVICE_NAME: z.string().regex(/^[a-z][a-z0-9-]*$/),
    HTTP_PORT: z.coerce.number().int().min(0).max(65_535),
    // One variable per upstream (CONVENTIONS service registry).
    CATALOG_GRPC: grpcAddress.default("localhost:50101"),
    SEARCH_GRPC: grpcAddress.default("localhost:50102"),
    PROFILE_GRPC: grpcAddress.default("localhost:50103"),
    CART_GRPC: grpcAddress.default("localhost:50104"),
    PROMOTION_GRPC: grpcAddress.default("localhost:50106"),
    ORDER_GRPC: grpcAddress.default("localhost:50107"),
    PAYMENT_GRPC: grpcAddress.default("localhost:50108"),
    REVIEW_GRPC: grpcAddress.default("localhost:50115"),
    SUPPORT_GRPC: grpcAddress.default("localhost:50116"),
    // The realtime service's WebSocket; /ws is proxied there (connect lazily, degrade if down).
    REALTIME_WS_URL: z.url().default("ws://localhost:8112/ws"),
    // PlaceOrder runs the checkout saga synchronously: it needs longer than the default deadline.
    PLACE_ORDER_DEADLINE_MS: z.coerce.number().int().positive().default(15_000),
    GRPC_DEADLINE_MS: z.coerce.number().int().positive().default(2_000),

    // Expected `iss` claim. Keycloak issues tokens for the browser's view of it
    // (http://localhost:8080/realms/kade) even when we reach it as keycloak:8080 inside Docker.
    KEYCLOAK_ISSUER: z.url(),
    // Where to fetch signing keys from; defaults to <issuer>/protocol/openid-connect/certs.
    KEYCLOAK_JWKS_URL: z.url().optional(),
    // Allowed `azp` (client) values; empty = any client of the realm.
    KEYCLOAK_CLIENTS: list.default([]),

    // DEV ONLY. Accepts "Bearer dev:<userId>:<roles>" tokens so apps work without Keycloak.
    AUTH_DEV_BYPASS: z.stringbool().default(false),
    DEPLOY_ENV: z.enum(["dev", "staging", "prod"]).default("prod"),

    CORS_ORIGINS: list.pipe(z.array(z.url()).min(1, "at least one origin")),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  })
  .refine((c) => !c.AUTH_DEV_BYPASS || c.DEPLOY_ENV === "dev", {
    path: ["AUTH_DEV_BYPASS"],
    message: "may only be enabled when DEPLOY_ENV=dev",
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
      return `  - ${key} (${value === undefined ? "unset" : JSON.stringify(value)}): ${i.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
