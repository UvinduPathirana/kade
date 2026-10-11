import type { FastifyPluginAsync } from "fastify";
import { telemetry } from "../telemetry.js";

export const healthRoutes =
  (lifecycle: { draining: boolean }): FastifyPluginAsync =>
  async (app) => {
    const config = { auth: "public" as const, otel: false };
    // Probes every few seconds would drown the request log.
    const quiet = { schema: { hide: true }, config, logLevel: "warn" as const };
    app.get("/health/live", quiet, async () => ({ status: "ok" }));
    // Deliberately NOT checking upstream services: one slow service must not take the whole
    // gateway out of rotation (its routes fail fast with 503/504 problems instead).
    app.get("/health/ready", quiet, async (_req, reply) =>
      lifecycle.draining ? reply.code(503).send({ status: "draining" }) : { status: "ok" },
    );
    app.get("/metrics", quiet, (req, reply) => {
      if (!telemetry.prometheus) return reply.code(503).send("metrics disabled\n");
      reply.hijack();
      telemetry.prometheus.getMetricsRequestHandler(req.raw, reply.raw);
    });
  };
