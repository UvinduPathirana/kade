import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import websocket from "@fastify/websocket";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { AuthError, type Authenticator, type Identity } from "./auth.js";
import type { Config } from "./config.js";
import type { CallContext } from "./grpc/call.js";
import { isServiceError } from "./grpc/call.js";
import type { TemplateServiceClient } from "@kade/proto/kade/template/v1/template";
import { Hub } from "./hub.js";
import { problem, problemFromGrpc, type Problem } from "./problem.js";
import { healthRoutes } from "./routes/health.js";
import { noteRoutes } from "./routes/notes.js";
import { wsRoutes } from "./routes/ws.js";
import { sharedSchemas } from "./schemas.js";

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | undefined;
  }
  interface FastifyContextConfig {
    /** required (default): 401 without a valid token. optional: identity if present. public: no auth. */
    auth?: "required" | "optional" | "public";
    /** Caller needs at least one of these realm roles (403 otherwise). */
    roles?: string[];
  }
}

export interface AppDeps {
  config: Config;
  logger: Logger;
  authenticator: Authenticator;
  template: TemplateServiceClient;
}

export type App = FastifyInstance<
  FastifyInstance["server"],
  FastifyRequest["raw"],
  FastifyReply["raw"],
  Logger,
  TypeBoxTypeProvider
>;

export interface Gateway {
  app: App;
  hub: Hub;
  /** Flipped at the start of shutdown so /health/ready fails before we stop serving. */
  lifecycle: { draining: boolean };
}

export async function buildApp(deps: AppDeps): Promise<Gateway> {
  const { config, authenticator } = deps;
  const app = Fastify({
    loggerInstance: deps.logger,
    // Behind Docker/ingress: honour X-Forwarded-* for req.ip and protocol.
    trustProxy: true,
    bodyLimit: 256 * 1024,
  }).withTypeProvider<TypeBoxTypeProvider>();
  const hub = new Hub();
  const lifecycle = { draining: false };

  for (const schema of sharedSchemas) app.addSchema(schema);

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: `Kadé ${config.SERVICE_NAME}`,
        version: "0.1.0",
        description:
          "Backend-for-frontend REST API. Money is whole rupees (LKR). Errors are application/problem+json " +
          "with a stable `code`. Mutations accept an `Idempotency-Key` header. Realtime: WebSocket /ws " +
          "(see the gateway README).",
      },
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      },
    },
    // Name components after each schema's $id instead of def-0, def-1, ...
    refResolver: { buildLocalReference: (json, _base, _fragment, i) => (json.$id as string) ?? `def-${i}` },
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "traceparent"],
    maxAge: 600,
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.decorateRequest("identity", undefined);
  app.addHook("onRequest", async (req, reply) => {
    // No matching route: let the 404 handler answer instead of asking for credentials.
    if (req.routeOptions.url === undefined) return;
    const mode = req.routeOptions.config.auth ?? "required";
    if (mode === "public") return;
    const header = req.headers.authorization;
    if (header) {
      const [scheme, token] = header.split(" ", 2);
      if (scheme?.toLowerCase() !== "bearer" || !token) {
        return sendProblem(reply, problem(401, "UNAUTHENTICATED", "Use a Bearer token.", meta(req)));
      }
      try {
        req.identity = await authenticator.authenticate(token);
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        req.log.info({ reason: err.message }, "rejected token");
        return sendProblem(reply, problem(401, "UNAUTHENTICATED", "Your session has expired.", meta(req)));
      }
      if (req.identity.dev) req.log.debug({ userId: req.identity.userId }, "AUTH_DEV_BYPASS identity");
    }
    if (!req.identity && mode === "required") {
      return sendProblem(reply, problem(401, "UNAUTHENTICATED", "Sign in to continue.", meta(req)));
    }
    const roles = req.routeOptions.config.roles;
    if (roles && !roles.some((r) => req.identity?.roles.includes(r))) {
      return sendProblem(
        reply,
        problem(403, "PERMISSION_DENIED", "You do not have access to this.", meta(req)),
      );
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (isServiceError(err)) {
      const p = problemFromGrpc(err, meta(req));
      if (p.status >= 500) req.log.warn({ err, code: p.code }, "upstream failure");
      return sendProblem(reply, p);
    }
    const e = err as { validation?: unknown; statusCode?: number; code?: string; message: string };
    if (e.validation) return sendProblem(reply, problem(400, "VALIDATION_FAILED", e.message, meta(req)));
    if (e.statusCode && e.statusCode < 500) {
      return sendProblem(reply, problem(e.statusCode, e.code ?? "BAD_REQUEST", e.message, meta(req)));
    }
    req.log.error({ err }, "unhandled error");
    return sendProblem(
      reply,
      problem(500, "INTERNAL", "Something went wrong on our side. Please try again.", meta(req)),
    );
  });
  app.setNotFoundHandler((req, reply) =>
    sendProblem(reply, problem(404, "ROUTE_NOT_FOUND", `No route ${req.method} ${req.url}`, meta(req))),
  );

  const callContext = (req: FastifyRequest, reply: FastifyReply): CallContext => {
    // Client went away before we answered: cancel the upstream call instead of finishing it.
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return { identity: req.identity, deadlineMs: config.GRPC_DEADLINE_MS, signal: controller.signal };
  };

  await app.register(healthRoutes(lifecycle));
  await app.register(noteRoutes({ template: deps.template, hub, callContext }));
  await app.register(wsRoutes({ authenticator, hub }));
  app.get("/openapi.json", { schema: { hide: true }, config: { auth: "public" } }, () => app.swagger());

  return { app, hub, lifecycle };
}

function meta(req: FastifyRequest): Pick<Problem, "instance" | "traceId"> {
  return { instance: req.url, traceId: trace.getActiveSpan()?.spanContext().traceId };
}

function sendProblem(reply: FastifyReply, p: Problem): FastifyReply {
  return reply.code(p.status).type("application/problem+json").send(p);
}
