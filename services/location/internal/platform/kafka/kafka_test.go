package kafka

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"google.golang.org/protobuf/proto"
)

// fakeTx records processed_events inserts; everything else is delegated to the handler.
type fakeTx struct {
	pgx.Tx
	seen map[any]bool
}

func (f *fakeTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "processed_events") {
		if f.seen[args[0]] {
			return pgconn.NewCommandTag("INSERT 0 0"), nil
		}
		f.seen[args[0]] = true
		return pgconn.NewCommandTag("INSERT 0 1"), nil
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

type harness struct {
	c        *Consumer
	dlq      []*kgo.Record
	commits  int
	handled  int
	failures int // handler fails this many times before succeeding
	permErr  bool
	after    int
}

func newHarness(t *testing.T) *harness {
	h := &harness{}
	r := NewRouter()
	Handle(r, func(ctx context.Context, tx pgx.Tx, d *Delivery, e *templatev1.NoteCreated) error {
		if h.permErr {
			return Permanent(errors.New("bad note"))
		}
		if h.failures > 0 {
			h.failures--
			return errors.New("db hiccup")
		}
		h.handled++
		d.AfterCommit(func(context.Context) { h.after++ })
		return nil
	})
	seen := map[any]bool{}
	h.c = &Consumer{
		o:      ConsumerOptions{Group: "location", Router: r, MaxAttempts: 5, Backoff: ExpBackoff(time.Millisecond, time.Millisecond)},
		log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
		tracer: otel.Tracer("test"),
		inTx: func(ctx context.Context, fn func(pgx.Tx) error) error {
			// Simulate rollback: a failed tx must not leave the event marked as processed.
			tx := &fakeTx{seen: map[any]bool{}}
			for k, v := range seen {
				tx.seen[k] = v
			}
			if err := fn(tx); err != nil {
				return err
			}
			seen = tx.seen
			h.commits++
			return nil
		},
		sendDLQ: func(_ context.Context, r *kgo.Record) error { h.dlq = append(h.dlq, r); return nil },
		sleep:   func(context.Context, time.Duration) error { return nil },
	}
	return h
}

func noteRecord(t *testing.T, id string) *kgo.Record {
	b, err := proto.Marshal(&templatev1.NoteCreated{NoteId: uuid.NewString(), Text: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	return &kgo.Record{Topic: "kade.note.events", Key: []byte("k"), Value: b, Offset: 7, Headers: []kgo.RecordHeader{
		{Key: HeaderEventID, Value: []byte(id)},
		{Key: HeaderEventType, Value: []byte("kade.template.v1.NoteCreated")},
	}}
}

func TestConsumerProcessesOnceAndDedups(t *testing.T) {
	h := newHarness(t)
	rec := noteRecord(t, uuid.NewString())
	for i, want := range []string{"processed", "duplicate"} {
		if got, err := h.c.handle(context.Background(), rec); got != want || err != nil {
			t.Fatalf("delivery %d: outcome %q err %v, want %q", i+1, got, err, want)
		}
	}
	if h.handled != 1 || h.after != 1 {
		t.Fatalf("handled %d times, after-commit %d times; want 1/1", h.handled, h.after)
	}
}

func TestConsumerRetriesTransientErrors(t *testing.T) {
	h := newHarness(t)
	h.failures = 3
	if got, _ := h.c.handle(context.Background(), noteRecord(t, uuid.NewString())); got != "processed" {
		t.Fatalf("outcome %q", got)
	}
	if h.handled != 1 || len(h.dlq) != 0 {
		t.Fatalf("handled=%d dlq=%d", h.handled, len(h.dlq))
	}
}

func TestConsumerDeadLettersAfterMaxAttempts(t *testing.T) {
	h := newHarness(t)
	h.failures = 100
	rec := noteRecord(t, uuid.NewString())
	got, err := h.c.handle(context.Background(), rec)
	if got != "dlq" || err == nil {
		t.Fatalf("outcome %q err %v", got, err)
	}
	if len(h.dlq) != 1 {
		t.Fatalf("dlq records = %d", len(h.dlq))
	}
	d := h.dlq[0]
	if d.Topic != "kade.note.events.dlq" || Header(d, HeaderAttempts) != "5" || Header(d, HeaderFailedBy) != "location" || Header(d, HeaderOriginalOffset) != "7" ||
		!strings.Contains(Header(d, HeaderError), "db hiccup") || Header(d, HeaderEventType) == "" || string(d.Value) != string(rec.Value) {
		t.Fatalf("unexpected DLQ record: topic=%s headers=%v", d.Topic, d.Headers)
	}
}

func TestConsumerPermanentErrorsSkipRetries(t *testing.T) {
	h := newHarness(t)
	h.permErr = true
	if got, _ := h.c.handle(context.Background(), noteRecord(t, uuid.NewString())); got != "dlq" {
		t.Fatalf("outcome %q", got)
	}
	if Header(h.dlq[0], HeaderAttempts) != "1" {
		t.Fatalf("attempts = %s", Header(h.dlq[0], HeaderAttempts))
	}

	// A malformed payload or event id is permanent too.
	h2 := newHarness(t)
	bad := noteRecord(t, "not-a-uuid")
	if got, _ := h2.c.handle(context.Background(), bad); got != "dlq" {
		t.Fatalf("bad id outcome %q", got)
	}
	garbage := noteRecord(t, uuid.NewString())
	garbage.Value = []byte{0xff, 0xff, 0xff}
	if got, _ := h2.c.handle(context.Background(), garbage); got != "dlq" {
		t.Fatalf("garbage outcome %q", got)
	}
}

func TestConsumerSkipsUnknownTypes(t *testing.T) {
	h := newHarness(t)
	rec := noteRecord(t, uuid.NewString())
	HeaderCarrier{rec}.Set(HeaderEventType, "kade.template.v1.SomethingNew")
	if got, _ := h.c.handle(context.Background(), rec); got != "skipped" || h.commits != 0 {
		t.Fatalf("outcome %q commits %d", got, h.commits)
	}
}

func TestConsumerStopsOnCancel(t *testing.T) {
	h := newHarness(t)
	h.failures = 100
	ctx, cancel := context.WithCancel(context.Background())
	h.c.sleep = func(context.Context, time.Duration) error { cancel(); return context.Canceled }
	if got, _ := h.c.handle(ctx, noteRecord(t, uuid.NewString())); got != "cancelled" || len(h.dlq) != 0 {
		t.Fatalf("outcome %q dlq %d", got, len(h.dlq))
	}
}

func TestHeaderCarrierPropagatesTraceparent(t *testing.T) {
	const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	src := &kgo.Record{Headers: []kgo.RecordHeader{{Key: "traceparent", Value: []byte(tp)}}}
	ctx := propagation.TraceContext{}.Extract(context.Background(), HeaderCarrier{src})
	dst := &kgo.Record{}
	propagation.TraceContext{}.Inject(ctx, HeaderCarrier{dst})
	if got := Header(dst, "traceparent"); got != tp {
		t.Fatalf("traceparent = %q", got)
	}
}

func TestExpBackoff(t *testing.T) {
	b := ExpBackoff(200*time.Millisecond, time.Second)
	want := []time.Duration{200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond, time.Second, time.Second}
	for i, w := range want {
		if got := b(i + 1); got != w {
			t.Errorf("attempt %d: %v want %v", i+1, got, w)
		}
	}
}

func TestConfluentFraming(t *testing.T) {
	p := &StreamProducer[*templatev1.Note]{schemaID: 42}
	p.prefix = []byte{0, 0, 0, 0, 42, 0} // id 42, message index [0] shortcut
	msg := &templatev1.Note{Id: "n1", Text: "hello", Amount: &commonv1.Money{AmountMinor: 1150, Currency: "LKR"}}
	b, err := p.Encode(msg)
	if err != nil {
		t.Fatal(err)
	}
	var out templatev1.Note
	id, err := DecodeConfluent(b, &out)
	if err != nil || id != 42 || !proto.Equal(msg, &out) {
		t.Fatalf("id=%d err=%v out=%v", id, err, &out)
	}
	if _, err := DecodeConfluent([]byte{1, 2}, &out); err == nil {
		t.Fatal("expected error for missing magic byte")
	}
}

func TestMessageIndexAndProtoText(t *testing.T) {
	md := (&templatev1.Note{}).ProtoReflect().Descriptor()
	idx := MessageIndex(md)
	if len(idx) != 1 || md.ParentFile().Messages().Get(idx[0]).FullName() != md.FullName() {
		t.Fatalf("index %v does not point at %s", idx, md.FullName())
	}
	text, err := ProtoText(md.ParentFile())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"package kade.template.v1;", "message Note {", `import "kade/common/v1/money.proto";`} {
		if !strings.Contains(text, want) {
			t.Errorf("schema text missing %q:\n%s", want, text)
		}
	}
	// Message order must be preserved for the index to stay valid.
	if strings.Index(text, "message Note {") > strings.Index(text, "message NoteCreated {") {
		t.Error("message order changed")
	}
}
