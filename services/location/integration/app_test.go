//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
	"github.com/twmb/franz-go/pkg/sr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/UvinduPathirana/kade/services/location/internal/app"
	"github.com/UvinduPathirana/kade/services/location/internal/config"
	"github.com/UvinduPathirana/kade/services/location/internal/note"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/redisx"
)

var (
	st     stack
	a      *app.App
	client templatev1.TemplateServiceClient
	raw    *kgo.Client // test producer/consumer
)

const eventsTopic = "kade.note.events"

func TestMain(m *testing.M) {
	st = resolveStack()
	fmt.Printf("integration: using shared stack via %s\n", st.Where)
	cfg := config.Config{
		// Own consumer group so a running template container does not steal our records.
		ServiceName: "location-it", Version: "test",
		GRPCPort: 0, HTTPPort: 0, // random free ports
		DatabaseURL: st.DatabaseURL, KafkaBrokers: st.Brokers, SchemaRegistryURL: st.SchemaRegistryURL, RedisURL: st.RedisURL,
		LogLevel: slog.LevelWarn, NoteEventsTopic: eventsTopic, StreamTopic: "kade.note.views",
		RPCTimeout: 5 * time.Second, ShutdownTimeout: 10 * time.Second, MigrateOnStart: true,
	}
	ctx, cancel := context.WithCancel(context.Background())
	var err error
	a, err = app.New(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "app.New:", err)
		os.Exit(1)
	}
	runErr := make(chan error, 1)
	go func() { runErr <- a.Run(ctx) }()

	conn, err := grpcx.Dial(a.GRPCAddr.String())
	if err != nil {
		panic(err)
	}
	client = templatev1.NewTemplateServiceClient(conn)
	if raw, err = kgo.NewClient(kgo.SeedBrokers(st.Brokers...)); err != nil {
		panic(err)
	}

	code := m.Run()

	// Graceful shutdown must finish well inside the timeout.
	conn.Close()
	raw.Close()
	cancel()
	select {
	case err := <-runErr:
		if err != nil {
			fmt.Fprintln(os.Stderr, "Run returned:", err)
			code = 1
		}
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "graceful shutdown timed out")
		code = 1
	}
	os.Exit(code)
}

func asUser(id string) context.Context {
	// No explicit deadline: grpcx.Dial applies the 2 s default to every call.
	return metadata.AppendToOutgoingContext(context.Background(), "x-user-id", id, "x-roles", "customer")
}

func eventually(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestHealthAndMetrics(t *testing.T) {
	resp, err := http.Get("http://" + a.HTTPAddr.String() + "/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var r struct{ Checks map[string]string }
	_ = json.Unmarshal(body, &r)
	if resp.StatusCode != 200 || r.Checks["postgres"] != "ok" || r.Checks["kafka"] != "ok" || r.Checks["redis"] != "ok" {
		t.Fatalf("ready = %d %s", resp.StatusCode, body)
	}

	_, _ = client.GetNote(asUser("u"), &templatev1.GetNoteRequest{Id: uuid.NewString()}) // produce some rpc metrics
	resp, err = http.Get("http://" + a.HTTPAddr.String() + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{"go_goroutines", "rpc_server_call_duration", "db_client"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("/metrics missing %s", want)
		}
	}
}

func TestCreateNoteOutboxAndIdempotency(t *testing.T) {
	key := uuid.NewString()
	req := &templatev1.CreateNoteRequest{Text: "kottu for two", Amount: &commonv1.Money{AmountMinor: 115000, Currency: "LKR"}, IdempotencyKey: key}
	first, err := client.CreateNote(asUser("u-it"), req)
	if err != nil {
		t.Fatal(err)
	}
	again, err := client.CreateNote(asUser("u-it"), req)
	if err != nil || again.Note.Id != first.Note.Id || !proto.Equal(again.Note, first.Note) {
		t.Fatalf("retry returned %v (err %v), want the original %v", again.GetNote(), err, first.Note)
	}
	_, err = client.CreateNote(asUser("u-it"), &templatev1.CreateNoteRequest{Text: "something else", IdempotencyKey: key})
	if status.Code(err) != codes.FailedPrecondition || apperr.Reason(err) != "IDEMPOTENCY_KEY_REUSED" {
		t.Fatalf("reused key: %v", err)
	}
	if _, err := client.CreateNote(context.Background(), &templatev1.CreateNoteRequest{Text: "x"}); apperr.Reason(err) != "AUTH_REQUIRED" {
		t.Fatalf("anonymous create: %v", err)
	}

	ctx := context.Background()
	var notes int
	if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM notes WHERE id = $1`, first.Note.Id).Scan(&notes); err != nil || notes != 1 {
		t.Fatalf("notes rows = %d (%v)", notes, err)
	}
	rows, err := a.Pool.Query(ctx, `SELECT aggregatetype, type, payload, traceparent FROM outbox WHERE aggregateid = $1`, first.Note.Id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
		var aggType, typ string
		var payload []byte
		var tp *string
		if err := rows.Scan(&aggType, &typ, &payload, &tp); err != nil {
			t.Fatal(err)
		}
		var evt templatev1.NoteCreated
		if err := proto.Unmarshal(payload, &evt); err != nil {
			t.Fatal(err)
		}
		if aggType != "note" || typ != "kade.template.v1.NoteCreated" || evt.NoteId != first.Note.Id || evt.Amount.AmountMinor != 115000 {
			t.Fatalf("outbox row: %s %s %v", aggType, typ, &evt)
		}
		if tp == nil || !regexp.MustCompile(`^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$`).MatchString(*tp) {
			t.Fatalf("traceparent = %v", tp)
		}
	}
	if n != 1 {
		t.Fatalf("outbox rows = %d, want exactly 1 despite the retry", n)
	}

	got, err := client.GetNote(asUser("u-it"), &templatev1.GetNoteRequest{Id: first.Note.Id})
	if err != nil || got.Note.Text != "kottu for two" {
		t.Fatalf("GetNote = %v, %v", got, err)
	}
	if _, err := client.GetNote(asUser("u-it"), &templatev1.GetNoteRequest{Id: uuid.NewString()}); apperr.Reason(err) != "NOTE_NOT_FOUND" {
		t.Fatalf("missing note: %v", err)
	}
}

// debeziumRecord builds what Debezium's outbox router publishes for a NoteCreated row.
func debeziumRecord(t *testing.T, key string, evt *templatev1.NoteCreated) (*kgo.Record, uuid.UUID) {
	id, _ := uuid.NewV7()
	b, err := proto.Marshal(evt)
	if err != nil {
		t.Fatal(err)
	}
	return &kgo.Record{Topic: eventsTopic, Key: []byte(key), Value: b, Headers: []kgo.RecordHeader{
		{Key: kafka.HeaderEventID, Value: []byte(id.String())},
		{Key: kafka.HeaderEventType, Value: []byte("kade.template.v1.NoteCreated")},
		{Key: kafka.HeaderTraceparent, Value: []byte("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")},
	}}, id
}

func processed(id uuid.UUID) bool {
	var ok bool
	_ = a.Pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM processed_events WHERE event_id = $1)`, id).Scan(&ok)
	return ok
}

func createNote(t *testing.T) *templatev1.Note {
	t.Helper()
	resp, err := client.CreateNote(asUser("u-it"), &templatev1.CreateNoteRequest{Text: "for the consumer"})
	if err != nil {
		t.Fatal(err)
	}
	return resp.Note
}

func TestConsumerIdempotentWithWebSocketFanOut(t *testing.T) {
	n := createNote(t)

	// A browser-style client watching this note on our instance's hub.
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws://"+a.HTTPAddr.String()+"/ws?channel="+note.Channel(n.Id), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	eventually(t, 2*time.Second, "ws subscription", func() bool { return a.Hub.Subscribers(note.Channel(n.Id)) == 1 })

	rec, eventID := debeziumRecord(t, n.Id, &templatev1.NoteCreated{NoteId: n.Id, Text: n.Text})
	if err := raw.ProduceSync(ctx, rec).FirstErr(); err != nil {
		t.Fatal(err)
	}
	eventually(t, 20*time.Second, "event processed", func() bool { return processed(eventID) })

	_, msg, err := ws.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(msg), eventID.String()) || !strings.Contains(string(msg), "kade.template.v1.NoteCreated") {
		t.Fatalf("ws message = %s", msg)
	}

	var first time.Time
	if err := a.Pool.QueryRow(ctx, `SELECT last_event_at FROM notes WHERE id = $1`, n.Id).Scan(&first); err != nil {
		t.Fatal(err)
	}

	// Redeliver the same event, then a sentinel on the same key (same partition, so it is handled
	// after the duplicate). The duplicate must not re-run the side effect.
	dup := *rec
	dup.Headers = append([]kgo.RecordHeader(nil), rec.Headers...)
	other := createNote(t)
	sentinel, sentinelID := debeziumRecord(t, n.Id, &templatev1.NoteCreated{NoteId: other.Id})
	if err := raw.ProduceSync(ctx, &dup, sentinel).FirstErr(); err != nil {
		t.Fatal(err)
	}
	eventually(t, 20*time.Second, "sentinel processed", func() bool { return processed(sentinelID) })
	var after time.Time
	if err := a.Pool.QueryRow(ctx, `SELECT last_event_at FROM notes WHERE id = $1`, n.Id).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.Equal(first) {
		t.Fatalf("duplicate delivery re-applied the side effect: %v -> %v", first, after)
	}
}

// The real path: CreateNote → outbox row → Debezium → kade.note.events → our consumer.
// Needs the connector: deploy/compose/connect/register-outbox.sh location location
func TestOutboxRelayEndToEnd(t *testing.T) {
	resp, err := http.Get(st.ConnectURL + "/connectors/outbox-location/status")
	if err != nil {
		t.Skipf("Kafka Connect unreachable (%v): outbox relay not tested", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), `"state":"RUNNING"`) {
		t.Skipf("outbox-location connector not running (%d %s): run register-outbox.sh location location", resp.StatusCode, body)
	}
	n := createNote(t)
	var eventID uuid.UUID
	if err := a.Pool.QueryRow(context.Background(), `SELECT id FROM outbox WHERE aggregateid = $1`, n.Id).Scan(&eventID); err != nil {
		t.Fatal(err)
	}
	eventually(t, 30*time.Second, "outbox event relayed by Debezium and consumed", func() bool { return processed(eventID) })
	var seen *time.Time
	if err := a.Pool.QueryRow(context.Background(), `SELECT last_event_at FROM notes WHERE id = $1`, n.Id).Scan(&seen); err != nil || seen == nil {
		t.Fatalf("side effect not applied: %v %v", seen, err)
	}
}

func TestPoisonEventGoesToDLQ(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rec, eventID := debeziumRecord(t, "poison", &templatev1.NoteCreated{})
	rec.Value = []byte{0xff, 0xff, 0xff, 0xff} // not a NoteCreated
	if err := raw.ProduceSync(ctx, rec).FirstErr(); err != nil {
		t.Fatal(err)
	}

	dlq, err := kgo.NewClient(kgo.SeedBrokers(st.Brokers...), kgo.ConsumeTopics(eventsTopic+".dlq"),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()))
	if err != nil {
		t.Fatal(err)
	}
	defer dlq.Close()
	for ctx.Err() == nil {
		fs := dlq.PollFetches(ctx)
		for _, r := range fs.Records() {
			// Every consumer group of the topic dead-letters it (the TS/Java templates too): find ours.
			if kafka.Header(r, kafka.HeaderEventID) != eventID.String() || kafka.Header(r, kafka.HeaderFailedBy) != a.Cfg.ServiceName {
				continue
			}
			if kafka.Header(r, kafka.HeaderOriginalTopic) != eventsTopic || !strings.Contains(kafka.Header(r, kafka.HeaderError), "decode") ||
				kafka.Header(r, kafka.HeaderAttempts) != "1" || string(r.Value) != string(rec.Value) {
				t.Fatalf("DLQ record headers: %v", r.Headers)
			}
			return
		}
	}
	t.Fatal("poison event never reached the DLQ")
}

func TestGeoIndex(t *testing.T) {
	ctx := context.Background()
	key := "location-it:geo:" + uuid.NewString()
	defer a.Redis.Del(ctx, key)
	geo := redisx.NewGeoIndex(a.Redis, key)
	colombo := redisx.Point{Lat: 6.9271, Lng: 79.8612}
	riders := map[string]redisx.Point{
		"rider-near": {Lat: 6.9290, Lng: 79.8620}, // ~230 m
		"rider-mid":  {Lat: 6.9400, Lng: 79.8700}, // ~1.7 km
		"rider-far":  {Lat: 7.2906, Lng: 80.6337}, // Kandy
	}
	for m, p := range riders {
		if err := geo.Upsert(ctx, m, p); err != nil {
			t.Fatal(err)
		}
	}
	hits, err := geo.Nearby(ctx, colombo, 3000, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 || hits[0].Member != "rider-near" || hits[1].Member != "rider-mid" || hits[0].DistanceMeters > 400 {
		t.Fatalf("hits = %+v", hits)
	}
	_ = geo.Remove(ctx, "rider-near")
	hits, _ = geo.Nearby(ctx, colombo, 3000, 1)
	if len(hits) != 1 || hits[0].Member != "rider-mid" {
		t.Fatalf("after remove: %+v", hits)
	}
	if err := geo.Upsert(ctx, "x", redisx.Point{Lat: 89, Lng: 0}); !errors.Is(err, redisx.ErrInvalidPoint) {
		t.Fatalf("polar point: %v", err)
	}
}

func topicExists(ctx context.Context, topic string) bool {
	req := kmsg.NewPtrMetadataRequest()
	rt := kmsg.NewMetadataRequestTopic()
	rt.Topic = kmsg.StringPtr(topic)
	req.Topics = append(req.Topics, rt)
	resp, err := req.RequestWith(ctx, raw)
	return err == nil && len(resp.Topics) == 1 && resp.Topics[0].ErrorCode == 0
}

func TestSchemaRegistryStream(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if a.Stream == nil {
		t.Fatal("stream producer not configured")
	}
	reg, _ := sr.NewClient(sr.URLs(st.SchemaRegistryURL))
	text, err := reg.SchemaTextByID(ctx, a.Stream.SchemaID())
	if err != nil || !strings.Contains(text, "message Note") {
		t.Fatalf("registered schema %d: %v\n%s", a.Stream.SchemaID(), err, text)
	}
	if _, err := reg.SchemaByVersion(ctx, "kade/common/v1/money.proto", -1); err != nil {
		t.Fatalf("referenced money.proto not registered: %v", err)
	}

	topic := a.Stream.Topic()
	if !topicExists(ctx, topic) {
		t.Skipf("topic %s does not exist (auto-create is off): schema registration verified, produce/consume skipped", topic)
	}
	n := createNote(t)
	if _, err := client.GetNote(asUser("u-it"), &templatev1.GetNoteRequest{Id: n.Id}); err != nil {
		t.Fatal(err)
	}
	cons, err := kgo.NewClient(kgo.SeedBrokers(st.Brokers...), kgo.ConsumeTopics(topic), kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()))
	if err != nil {
		t.Fatal(err)
	}
	defer cons.Close()
	for ctx.Err() == nil {
		for _, r := range cons.PollFetches(ctx).Records() {
			if string(r.Key) != n.Id {
				continue
			}
			var got templatev1.Note
			id, err := kafka.DecodeConfluent(r.Value, &got)
			if err != nil || id != a.Stream.SchemaID() || got.Text != n.Text {
				t.Fatalf("decoded id=%d note=%v err=%v", id, &got, err)
			}
			if kafka.Header(r, kafka.HeaderTraceparent) == "" {
				t.Fatal("stream record has no traceparent")
			}
			return
		}
	}
	t.Fatal("view record not found on " + topic)
}
