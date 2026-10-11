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
import { Database } from "./db/database.js";
import { KafkaClient } from "./kafka/kafka-client.js";
import { telemetry } from "./telemetry.js";

/** Flipped at the start of graceful shutdown so load balancers stop routing before we stop serving. */
@Injectable()
export class Lifecycle {
  draining = false;
}

/**
 * Extra readiness checks registered by feature modules (e.g. the Temporal worker). A probe returns
 * true when healthy; anything else fails /health/ready.
 */
@Injectable()
export class ReadinessProbes {
  readonly probes = new Map<string, () => boolean | Promise<boolean>>();
  register(name: string, probe: () => boolean | Promise<boolean>): void {
    this.probes.set(name, probe);
  }
}

@Controller()
export class HealthController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(KafkaClient) private readonly kafka: KafkaClient,
    @Inject(Lifecycle) private readonly lifecycle: Lifecycle,
    @Inject(ReadinessProbes) private readonly extra: ReadinessProbes,
  ) {}

  /** Process is up. Never checks dependencies: a DB outage must not get every replica restarted. */
  @Get("health/live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Ready for traffic: dependencies reachable and not shutting down. */
  @Get("health/ready")
  @HttpCode(200)
  async ready(): Promise<{ status: "ok"; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    const [db, kafka] = await Promise.allSettled([this.database.ping(), this.kafka.ping()]);
    checks.postgres = db.status === "fulfilled" ? "ok" : String(db.reason);
    checks.kafka = kafka.status === "fulfilled" && kafka.value ? "ok" : "unreachable";
    for (const [name, probe] of this.extra.probes) {
      const ok = await Promise.resolve()
        .then(probe)
        .catch(() => false);
      checks[name] = ok ? "ok" : "unavailable";
    }
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
