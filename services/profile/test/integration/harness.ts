// Shared setup for the integration suites. They run against the SHARED stack (pnpm infra:up):
// Postgres `profile` (host port from DATABASE_URL, default 15432 on this laptop), Kafka, Debezium
// (connector outbox-profile) and Keycloak. Nothing here starts containers.
import { credentials, Metadata, type CallOptions, type ServiceError, type status } from "@grpc/grpc-js";
import type { INestApplication } from "@nestjs/common";
import {
  AuditServiceClient,
  PhoneSignInServiceClient,
  StaffServiceClient,
} from "@kade/proto/kade/identity/v1/identity_service";
import {
  AddressServiceClient,
  CreditServiceClient,
  CustomerServiceClient,
  FavouriteServiceClient,
  PlusServiceClient,
} from "@kade/proto/kade/profile/v1/profile_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import { startApp } from "../../src/app.js";
import { loadConfig, type Config } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

export const config: Config = loadConfig({
  SERVICE_NAME: "profile",
  DATABASE_URL: "postgres://profile:profile@localhost:15432/profile",
  KAFKA_BROKERS: "localhost:19092",
  KEYCLOAK_URL: "http://localhost:8080",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
});

/**
 * Customer ids for test-created customers. The "it-" prefix lets close() delete exactly what the
 * tests created from the shared database, leaving the demo seed and real sign-ups alone.
 */
export const testId = (): string => `it-${uuidv7()}`;

export interface Harness {
  app: INestApplication;
  pool: pg.Pool;
  customers: CustomerServiceClient;
  addresses: AddressServiceClient;
  favourites: FavouriteServiceClient;
  credit: CreditServiceClient;
  plus: PlusServiceClient;
  phone: PhoneSignInServiceClient;
  staff: StaffServiceClient;
  audit: AuditServiceClient;
  /** Extra customer ids to delete on close (e.g. Keycloak subs created by phone sign-in). */
  cleanupIds: string[];
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const app = await startApp(config, createLogger(config));
  const address = `localhost:${app.get(GrpcServer).port}`;
  const insecure = credentials.createInsecure();
  const clients = {
    customers: new CustomerServiceClient(address, insecure),
    addresses: new AddressServiceClient(address, insecure),
    favourites: new FavouriteServiceClient(address, insecure),
    credit: new CreditServiceClient(address, insecure),
    plus: new PlusServiceClient(address, insecure),
    phone: new PhoneSignInServiceClient(address, insecure),
    staff: new StaffServiceClient(address, insecure),
    audit: new AuditServiceClient(address, insecure),
  };
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  const cleanupIds: string[] = [];
  return {
    app,
    pool,
    ...clients,
    cleanupIds,
    async close() {
      Object.values(clients).forEach((c) => c.close());
      // Child rows cascade; outbox rows stay (already published, and they're the event history).
      await pool.query("delete from customers where id like 'it-%' or id = any($1)", [cleanupIds]);
      await pool.query("delete from waitlist where customer_id like 'it-%'");
      await pool.query("delete from credit_reversals where customer_id like 'it-%'");
      await pool.query("delete from risk_signals where customer_id like 'it-%'");
      await pool.query("delete from audit_entries where record_id like 'it-%'");
      await pool.end();
      await app.close();
    },
  };
}

/** Gateway-style identity metadata. No userId = an internal (service-to-service) call. */
export function as(userId?: string, roles = "customer"): Metadata {
  const md = new Metadata();
  if (userId) md.set("x-user-id", userId);
  if (roles) md.set("x-roles", roles);
  return md;
}

type Unary<Req, Res> = (
  request: Req,
  metadata: Metadata,
  options: Partial<CallOptions>,
  callback: (error: ServiceError | null, response: Res) => void,
) => unknown;

/** Promisified unary call with a deadline: rpc(client.getCustomer.bind(client), req, md). */
export function rpc<Req, Res>(
  fn: Unary<Req, Res>,
  request: Req,
  md: Metadata = new Metadata(),
): Promise<Res> {
  return new Promise((resolve, reject) =>
    fn(request, md, { deadline: Date.now() + 10_000 }, (err, res) => (err ? reject(err) : resolve(res))),
  );
}

export async function grpcError(
  promise: Promise<unknown>,
): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata?.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

export async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}
