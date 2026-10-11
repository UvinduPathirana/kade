import type { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

// Filled in by instrumentation.ts (loaded with `node --import` before the app). Tests and tools that
// skip instrumentation see an empty holder: /metrics answers 503 and shutdown has nothing to flush.
export const telemetry: {
  prometheus?: PrometheusExporter;
  shutdown?: () => Promise<void>;
} = {};
