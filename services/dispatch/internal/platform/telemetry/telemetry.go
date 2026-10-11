// Package telemetry wires OpenTelemetry traces, metrics and logs.
//
//   - Traces: OTLP/HTTP to OTEL_EXPORTER_OTLP_ENDPOINT (when set). W3C traceparent is the global
//     propagator, so gRPC metadata, Kafka headers and the outbox all carry the same format.
//   - Metrics: one MeterProvider with two readers: Prometheus (served on /metrics) and OTLP push.
//   - Logs: JSON slog on stdout with trace_id/span_id, plus the OTel log bridge when OTLP is on.
package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.43.0"
)

type Options struct {
	ServiceName  string
	Version      string
	OTLPEndpoint string // e.g. http://otel:4318; empty = no export
	LogLevel     slog.Level
}

type Telemetry struct {
	Logger         *slog.Logger
	MetricsHandler http.Handler
	shutdown       []func(context.Context) error
}

// Setup installs global providers and returns the logger and /metrics handler.
func Setup(ctx context.Context, o Options) (*Telemetry, error) {
	t := &Telemetry{}
	// Attributes only (no schema URL), so SDK upgrades can't cause schema-URL conflicts.
	res, err := resource.New(ctx,
		resource.WithTelemetrySDK(),
		resource.WithFromEnv(), // OTEL_RESOURCE_ATTRIBUTES, e.g. deployment.environment.name=dev
		resource.WithAttributes(semconv.ServiceName(o.ServiceName), semconv.ServiceVersion(o.Version)),
	)
	if err != nil {
		return nil, err
	}
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	endpoint := strings.TrimRight(o.OTLPEndpoint, "/")

	// Traces. Without an exporter we still create real spans so logs get trace ids.
	tpOpts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}
	if endpoint != "" {
		exp, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"))
		if err != nil {
			return nil, err
		}
		tpOpts = append(tpOpts, sdktrace.WithBatcher(exp))
	}
	tp := sdktrace.NewTracerProvider(tpOpts...)
	otel.SetTracerProvider(tp)
	t.shutdown = append(t.shutdown, tp.Shutdown)

	// Metrics: Prometheus pull on /metrics (+ Go runtime/process collectors) and OTLP push.
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	promExp, err := otelprom.New(otelprom.WithRegisterer(reg))
	if err != nil {
		return nil, err
	}
	mpOpts := []sdkmetric.Option{sdkmetric.WithResource(res), sdkmetric.WithReader(promExp)}
	if endpoint != "" {
		mexp, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithEndpointURL(endpoint+"/v1/metrics"))
		if err != nil {
			return nil, err
		}
		mpOpts = append(mpOpts, sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp, sdkmetric.WithInterval(15*time.Second))))
	}
	mp := sdkmetric.NewMeterProvider(mpOpts...)
	otel.SetMeterProvider(mp)
	t.shutdown = append(t.shutdown, mp.Shutdown)
	t.MetricsHandler = promhttp.HandlerFor(reg, promhttp.HandlerOpts{})

	// Logs: stdout JSON always; OTLP via the slog bridge when configured.
	var handler slog.Handler = NewTraceHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: o.LogLevel}))
	if endpoint != "" {
		lexp, err := otlploghttp.New(ctx, otlploghttp.WithEndpointURL(endpoint+"/v1/logs"))
		if err != nil {
			return nil, err
		}
		lp := sdklog.NewLoggerProvider(sdklog.WithResource(res), sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)))
		global.SetLoggerProvider(lp)
		t.shutdown = append(t.shutdown, lp.Shutdown)
		otlpHandler := levelFilter{Handler: otelslog.NewHandler(o.ServiceName, otelslog.WithLoggerProvider(lp)), min: o.LogLevel}
		handler = fanout{handler, otlpHandler}
	}
	t.Logger = slog.New(handler).With("service", o.ServiceName)
	slog.SetDefault(t.Logger)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) { t.Logger.Warn("otel", "err", err) }))
	return t, nil
}

// Shutdown flushes exporters (reverse order of creation).
func (t *Telemetry) Shutdown(ctx context.Context) error {
	var errs []error
	for i := len(t.shutdown) - 1; i >= 0; i-- {
		errs = append(errs, t.shutdown[i](ctx))
	}
	return errors.Join(errs...)
}
