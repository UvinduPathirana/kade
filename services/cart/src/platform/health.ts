import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RedisClient } from "./redis/redis.js";
import { telemetry } from "./telemetry.js";

/** Flipped at the start of graceful shutdown so load balancers stop routing before we stop serving. */
@Injectable()
export class Lifecycle {
  draining = false;
}

@Controller()
export class HealthController {
  constructor(
    @Inject(RedisClient) private readonly redis: RedisClient,
    @Inject(Lifecycle) private readonly lifecycle: Lifecycle,
  ) {}

  /** Process is up. Never checks dependencies: a Redis outage must not get every replica restarted. */
  @Get("health/live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Ready for traffic: dependencies reachable and not shutting down. */
  @Get("health/ready")
  @HttpCode(200)
  async ready(): Promise<{ status: "ok"; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    // Only Redis: catalog/pricing outages degrade single RPCs with a clear error, they must not
    // take the whole cart out of the load balancer.
    const [redis] = await Promise.allSettled([this.redis.ping()]);
    checks.redis = redis.status === "fulfilled" ? "ok" : String(redis.reason);
    if (this.lifecycle.draining) checks.lifecycle = "draining";
    const ok = Object.values(checks).every((v) => v === "ok");
    if (!ok) throw new ServiceUnavailableException({ status: "unavailable", checks });
    return { status: "ok", checks };
  }

  /** Prometheus text format, from the same OTel MeterProvider that pushes OTLP. */
  @Get("metrics")
  @Header("Cache-Control", "no-store")
  metrics(@Req() req: IncomingMessage, @Res() res: ServerResponse): void {
    if (!telemetry.prometheus) {
      res.statusCode = 503;
      res.end("metrics disabled (instrumentation.ts not loaded)\n");
      return;
    }
    telemetry.prometheus.getMetricsRequestHandler(req, res);
  }
}
