// OpenTelemetry bootstrap. Must run before any instrumented module (@grpc/grpc-js, pino, http)
// is imported, which is why it is loaded with `node --import ./dist/instrumentation.js dist/main.js`
// rather than imported from main.ts.
import { register } from "node:module";
import { createAddHookMessageChannel } from "import-in-the-middle";
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
import { telemetry } from "./platform/telemetry.js";

// ESM imports are only interceptable through a loader hook; the message channel limits the hook to
// the modules the instrumentations below ask for, instead of wrapping every import.
const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register("import-in-the-middle/hook.mjs", import.meta.url, registerOptions);

const serviceName = process.env.SERVICE_NAME ?? "unknown-service";
// Config validation proper happens in main.ts; here we only need to know whether to export.
const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// Pull-based /metrics (Prometheus text) and push-based OTLP share one MeterProvider.
const prometheus = new PrometheusExporter({ preventServerStart: true });
const metricReaders: IMetricReader[] = [prometheus];
if (otlp) {
  metricReaders.push(
    new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(), exportIntervalMillis: 15_000 }),
  );
}

const ignoredPaths = new Set(["/health/live", "/health/ready", "/metrics"]);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
  // Exporters read OTEL_EXPORTER_OTLP_ENDPOINT themselves and append /v1/traces etc.
  spanProcessors: otlp ? [new BatchSpanProcessor(new OTLPTraceExporter())] : [],
  logRecordProcessors: otlp ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })] : [],
  metricReaders,
  instrumentations: [
    new HttpInstrumentation({
      // Probes and scrapes would otherwise be most of the traces.
      ignoreIncomingRequestHook: (req) => ignoredPaths.has((req.url ?? "").split("?")[0] ?? ""),
    }),
    new GrpcInstrumentation(),
    new PinoInstrumentation({ disableLogSending: !otlp }),
  ],
});
sdk.start();

telemetry.prometheus = prometheus;
telemetry.shutdown = () => sdk.shutdown();

await waitForAllMessagesAcknowledged();
