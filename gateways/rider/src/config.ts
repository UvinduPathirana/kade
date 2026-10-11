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
    // One variable per upstream (CONVENTIONS: <NAME>_GRPC).
    DISPATCH_GRPC: grpcAddress.default("localhost:50110"),
    LOCATION_GRPC: grpcAddress.default("localhost:50111"),
    LEDGER_GRPC: grpcAddress.default("localhost:50113"),
    REVIEW_GRPC: grpcAddress.default("localhost:50115"),
    SUPPORT_GRPC: grpcAddress.default("localhost:50116"),
    // Realtime WebSocket (offers, job changes). /ws is proxied there when it answers; empty = off.
    REALTIME_WS_URL: z.union([z.literal(""), z.url()]).default("ws://localhost:8112/ws"),
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

    // Rider resolution while dispatch's GetMyRider can't answer: "nimal=<riderId>" (keys: Keycloak
    // username or user id).
    RIDER_IDS: z
      .string()
      .default("")
      .transform((s) =>
        Object.fromEntries(
          s
            .split(",")
            .map((pair) => pair.split("=").map((v) => v.trim()))
            .filter((kv): kv is [string, string] => kv.length === 2 && !!kv[0] && !!kv[1]),
        ),
      ),
    // DEV ONLY fallback: every rider without a mapping acts as this rider (Nimal).
    DEFAULT_RIDER_ID: z.string().default(""),

    CORS_ORIGINS: list.pipe(z.array(z.url()).min(1, "at least one origin")),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  })
  .refine((c) => !c.AUTH_DEV_BYPASS || c.DEPLOY_ENV === "dev", {
    path: ["AUTH_DEV_BYPASS"],
    message: "may only be enabled when DEPLOY_ENV=dev",
  })
  .refine((c) => !c.DEFAULT_RIDER_ID || c.DEPLOY_ENV === "dev", {
    path: ["DEFAULT_RIDER_ID"],
    message: "may only be set when DEPLOY_ENV=dev",
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
