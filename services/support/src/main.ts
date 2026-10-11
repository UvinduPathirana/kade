import { ConfigError, loadConfig, type Config } from "./platform/config.js";
import { Lifecycle } from "./platform/health.js";
import { createLogger } from "./platform/logger.js";
import { telemetry } from "./platform/telemetry.js";
import { startApp } from "./app.js";

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(78); // EX_CONFIG: distinguishes "fix your env" from a crash in container restarts
  }
  throw err;
}

const logger = createLogger(config);
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));

const app = await startApp(config, logger).catch((err: unknown) => {
  logger.fatal({ err }, "startup failed");
  process.exit(1);
});
logger.info({ grpcPort: config.GRPC_PORT, httpPort: config.HTTP_PORT }, "service started");

// Order: fail readiness -> stop gRPC + consumer (in-flight work finishes, offsets commit) ->
// close HTTP and the DB pool -> flush telemetry. A hard timer guarantees we exit regardless.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const hardStop = setTimeout(() => {
    logger.error("shutdown timed out; exiting");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  hardStop.unref();

  app.get(Lifecycle).draining = true;
  try {
    await app.close();
    await telemetry.shutdown?.();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
