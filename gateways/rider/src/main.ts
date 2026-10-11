import { buildApp } from "./app.js";
import { createAuthenticator } from "./auth.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { closeUpstreams, createUpstreams } from "./grpc/clients.js";
import { LocationForwarder } from "./location.js";
import { createLogger } from "./logger.js";
import { telemetry } from "./telemetry.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(78); // EX_CONFIG
  }
  throw err;
}

const logger = createLogger(config);
if (config.AUTH_DEV_BYPASS) {
  logger.warn("AUTH_DEV_BYPASS is ON: 'Bearer dev:<user>:<roles>' tokens are accepted without Keycloak");
}

if (config.DEFAULT_RIDER_ID) {
  logger.warn(
    { riderId: config.DEFAULT_RIDER_ID },
    "DEFAULT_RIDER_ID is set: unmapped riders act as this rider",
  );
}

const upstreams = createUpstreams(config);
const location = new LocationForwarder(upstreams.location, logger);
const { app, hub, lifecycle } = await buildApp({
  config,
  logger,
  authenticator: createAuthenticator(config),
  upstreams,
  location,
});
await app.listen({ port: config.HTTP_PORT, host: "0.0.0.0" });

// Fail readiness, close sockets (1001 = going away, clients reconnect elsewhere), let in-flight
// requests finish (app.close), close upstream channels, flush telemetry.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  setTimeout(() => {
    logger.error("shutdown timed out; exiting");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS).unref();
  lifecycle.draining = true;
  try {
    hub.closeAll(1001, "server restarting");
    await app.close();
    location.closeAll();
    closeUpstreams(upstreams);
    await telemetry.shutdown?.();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
