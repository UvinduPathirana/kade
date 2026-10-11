package telemetry

import (
	"context"
	"errors"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
)

// TraceHandler adds trace_id and span_id to every record logged with a context that carries a span.
// Always log with the *Context variants (logger.InfoContext(ctx, ...)) to get correlation.
type TraceHandler struct{ slog.Handler }

func NewTraceHandler(h slog.Handler) *TraceHandler { return &TraceHandler{h} }

func (h *TraceHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(slog.String("trace_id", sc.TraceID().String()), slog.String("span_id", sc.SpanID().String()))
	}
	return h.Handler.Handle(ctx, r)
}

func (h *TraceHandler) WithAttrs(as []slog.Attr) slog.Handler {
	return &TraceHandler{h.Handler.WithAttrs(as)}
}
func (h *TraceHandler) WithGroup(name string) slog.Handler {
	return &TraceHandler{h.Handler.WithGroup(name)}
}

// fanout sends each record to several handlers (slog.NewMultiHandler arrives in Go 1.26).
type fanout []slog.Handler

func (f fanout) Enabled(ctx context.Context, l slog.Level) bool {
	for _, h := range f {
		if h.Enabled(ctx, l) {
			return true
		}
	}
	return false
}

func (f fanout) Handle(ctx context.Context, r slog.Record) error {
	var errs []error
	for _, h := range f {
		if h.Enabled(ctx, r.Level) {
			errs = append(errs, h.Handle(ctx, r.Clone()))
		}
	}
	return errors.Join(errs...)
}

func (f fanout) WithAttrs(as []slog.Attr) slog.Handler {
	out := make(fanout, len(f))
	for i, h := range f {
		out[i] = h.WithAttrs(as)
	}
	return out
}

func (f fanout) WithGroup(name string) slog.Handler {
	out := make(fanout, len(f))
	for i, h := range f {
		out[i] = h.WithGroup(name)
	}
	return out
}

// levelFilter applies LOG_LEVEL to handlers that have no level option (the OTel bridge).
type levelFilter struct {
	slog.Handler
	min slog.Level
}

func (l levelFilter) Enabled(ctx context.Context, lv slog.Level) bool {
	return lv >= l.min && l.Handler.Enabled(ctx, lv)
}
func (l levelFilter) WithAttrs(as []slog.Attr) slog.Handler {
	return levelFilter{l.Handler.WithAttrs(as), l.min}
}
func (l levelFilter) WithGroup(n string) slog.Handler {
	return levelFilter{l.Handler.WithGroup(n), l.min}
}
