import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import type { Config } from "./platform/config.js";
import { NestPinoLogger, type Logger } from "./platform/logger.js";

/** Builds and starts the app (migrations, gRPC, consumer, HTTP). Shared by main.ts and tests. */
export async function startApp(config: Config, logger: Logger): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, logger), {
    logger: new NestPinoLogger(logger.child({ component: "nest" })),
    // Our own signal handling in main.ts orders the shutdown; Nest's would race it.
    abortOnError: false,
  });
  await app.listen(config.HTTP_PORT, "0.0.0.0");
  return app;
}
