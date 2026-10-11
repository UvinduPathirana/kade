import type { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

// Filled in by instrumentation.ts (node --import). Empty in tests and in the OpenAPI generator.
export const telemetry: { prometheus?: PrometheusExporter; shutdown?: () => Promise<void> } = {};
