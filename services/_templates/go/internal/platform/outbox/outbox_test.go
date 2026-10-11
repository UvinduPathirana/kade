package outbox

import (
	"context"
	"strings"
	"testing"

	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/protobuf/proto"
)

func TestBuild(t *testing.T) {
	ctx, span := sdktrace.NewTracerProvider().Tracer("t").Start(context.Background(), "CreateNote")
	defer span.End()
	evt := &templatev1.NoteCreated{NoteId: "n1", Text: "hi"}
	row, err := Build(ctx, Event{AggregateType: "note", AggregateID: "n1", Message: evt})
	if err != nil {
		t.Fatal(err)
	}
	if row.Type != "kade.template.v1.NoteCreated" {
		t.Fatalf("type = %s", row.Type)
	}
	if row.ID.Version() != 7 {
		t.Fatalf("id %s is not UUIDv7", row.ID)
	}
	var back templatev1.NoteCreated
	if err := proto.Unmarshal(row.Payload, &back); err != nil || !proto.Equal(&back, evt) {
		t.Fatalf("payload roundtrip: %v", err)
	}
	if !strings.Contains(row.Traceparent, span.SpanContext().TraceID().String()) {
		t.Fatalf("traceparent %q does not carry the trace id", row.Traceparent)
	}
	// The stored traceparent restores the same trace on the consumer side.
	restored := propagation.TraceContext{}.Extract(context.Background(), propagation.MapCarrier{"traceparent": row.Traceparent})
	if got := trace.SpanContextFromContext(restored).TraceID(); got != span.SpanContext().TraceID() {
		t.Fatalf("restored trace id %s", got)
	}
}

func TestBuildWithoutTrace(t *testing.T) {
	row, err := Build(context.Background(), Event{AggregateType: "note", AggregateID: "n1", Message: &templatev1.NoteCreated{}})
	if err != nil || row.Traceparent != "" {
		t.Fatalf("row=%+v err=%v", row, err)
	}
}
