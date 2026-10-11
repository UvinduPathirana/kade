package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestTraceHandlerAddsIDs(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(NewTraceHandler(slog.NewJSONHandler(&buf, nil))).With("service", "t")
	ctx, span := sdktrace.NewTracerProvider().Tracer("t").Start(context.Background(), "op")
	log.InfoContext(ctx, "hello")
	span.End()

	var rec map[string]any
	if err := json.Unmarshal(buf.Bytes(), &rec); err != nil {
		t.Fatal(err)
	}
	if rec["trace_id"] != span.SpanContext().TraceID().String() || rec["span_id"] == nil || rec["service"] != "t" {
		t.Fatalf("record = %v", rec)
	}

	buf.Reset()
	log.Info("no ctx")
	if bytes.Contains(buf.Bytes(), []byte("trace_id")) {
		t.Fatal("trace_id added without a span")
	}
}

func TestFanoutRespectsLevels(t *testing.T) {
	var a, b bytes.Buffer
	h := fanout{
		slog.NewJSONHandler(&a, &slog.HandlerOptions{Level: slog.LevelDebug}),
		levelFilter{slog.NewJSONHandler(&b, &slog.HandlerOptions{Level: slog.LevelDebug}), slog.LevelWarn},
	}
	log := slog.New(h)
	log.Debug("d")
	log.Warn("w")
	if bytes.Count(a.Bytes(), []byte("\n")) != 2 || bytes.Count(b.Bytes(), []byte("\n")) != 1 {
		t.Fatalf("a=%q b=%q", a.String(), b.String())
	}
}
