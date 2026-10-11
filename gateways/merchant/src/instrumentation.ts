// OpenTelemetry bootstrap; loaded with `node --import ./dist/instrumentation.js dist/main.js` so it
// runs before fastify, @grpc/grpc-js, pino and http are imported (same pattern as the services).
import { register } from "node:module";
import { createAddHookMessageChannel } from "import-in-the-middle";
import fastifyOtel from "@fastify/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { PeriodicExportingMetricReader, type IMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { GrpcInstrumentation } from "@opentelemetry/instrumentation-grpc";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { telemetry } from "./telemetry.js";

const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const prometheus = new PrometheusExporter({ preventServerStart: true });
const metricReaders: IMetricReader[] = [prometheus];
if (otlp) {
  metricReaders.push(
    new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15_000 }),
  );
}
const ignoredPaths = new Set(["/health/live", "/health/ready", "/metrics"]);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.SERVICE_NAME ?? "gateway" }),
  spanProcessors: otlp ? [new BatchSpanProcessor(new OTLPTraceExporter())] : [],
  logRecordProcessors: otlp ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })] : [],
  metricReaders,
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) => ignoredPaths.has((req.url ?? "").split("?")[0] ?? ""),
    }),
    // Route-level spans (http.route = /v1/notes/:id) via Fastify's diagnostics channel.
    new fastifyOtel.FastifyOtelInstrumentation({ registerOnInitialization: true }),
    // Client spans for upstream calls; injects traceparent into gRPC metadata.
    new GrpcInstrumentation(),
    new PinoInstrumentation({ disableLogSending: !otlp }),
  ],
});
sdk.start();

telemetry.prometheus = prometheus;
telemetry.shutdown = () => sdk.shutdown();

await waitForAllMessagesAcknowledged();
