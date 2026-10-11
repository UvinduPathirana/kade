// Writes the OpenAPI document generated from the route schemas (no server, no upstreams):
//   pnpm --filter @kade/gateway-template openapi   -> openapi.json
// Wave 2 generates typed app clients from it (e.g. openapi-typescript).
import { writeFileSync } from "node:fs";
import { pino } from "pino";
import { buildApp } from "./app.js";
import type { Authenticator } from "./auth.js";
import { loadConfig } from "./config.js";
import { createTemplateClient } from "./grpc/clients.js";

const config = loadConfig({
  SERVICE_NAME: "gateway-template",
  HTTP_PORT: "0",
  TEMPLATE_GRPC: "localhost:1",
  KEYCLOAK_ISSUER: "http://localhost/realms/kade",
  CORS_ORIGINS: "http://localhost",
  ...process.env,
});
const template = createTemplateClient(config.TEMPLATE_GRPC);
const authenticator: Authenticator = { authenticate: () => Promise.reject(new Error("unused")) };
const { app } = await buildApp({ config, logger: pino({ level: "silent" }), authenticator, template });
await app.ready();
const out = process.argv[2] ?? "openapi.json";
writeFileSync(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
template.close();
await app.close();
console.log(`wrote ${out}`);
