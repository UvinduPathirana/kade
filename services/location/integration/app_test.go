//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/location/internal/app"
	"github.com/UvinduPathirana/kade/services/location/internal/config"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/location/internal/positions"
)

var (
	st     stack
	a      *app.App
	client locationv1.LocationServiceClient
)

func TestMain(m *testing.M) {
	st = resolveStack()
	fmt.Printf("integration: using shared stack via %s\n", st.Where)
	cfg := config.Config{
		ServiceName: "location-it", Version: "test", GRPCPort: 0, HTTPPort: 0,
		KafkaBrokers: st.Brokers, SchemaRegistryURL: st.SchemaRegistryURL, RedisURL: st.RedisURL,
		LogLevel: slog.LevelWarn, StreamTopic: "kade.rider.locations", LastKnownTTL: 30 * time.Minute,
		RetainPositions: 6 * time.Hour, MaxSpeedMPS: 50, RPCTimeout: 5 * time.Second, ShutdownTimeout: 10 * time.Second,
	}
	ctx, cancel := context.WithCancel(context.Background())
	var err error
	if a, err = app.New(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "app.New:", err)
		os.Exit(1)
	}
	runErr := make(chan error, 1)
	go func() { runErr <- a.Run(ctx) }()
	conn, err := grpcx.Dial(a.GRPCAddr.String())
	if err != nil {
		panic(err)
	}
	client = locationv1.NewLocationServiceClient(conn)

	code := m.Run()
	conn.Close()
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

func TestHealth(t *testing.T) {
	resp, err := http.Get("http://" + a.HTTPAddr.String() + "/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var r struct{ Checks map[string]string }
	_ = json.Unmarshal(body, &r)
	if resp.StatusCode != 200 || r.Checks["kafka"] != "ok" || r.Checks["redis"] != "ok" {
		t.Fatalf("ready = %d %s", resp.StatusCode, body)
	}
}

// A rider's pings go through the client stream → Redis (last known) and kade.rider.locations
// (Confluent wire format, key = rider id), readable by any Confluent deserializer.
func TestStreamToRedisAndKafka(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	rider := "it-" + uuid.NewString()
	defer a.Redis.HDel(context.Background(), positions.KeyLast, rider)
	defer a.Redis.ZRem(context.Background(), positions.KeyGeo, rider)
	defer a.Redis.ZRem(context.Background(), positions.KeySeen, rider)

	// Start reading the topic from the current end before producing.
	consumer, err := kgo.NewClient(kgo.SeedBrokers(st.Brokers...), kgo.ConsumeTopics("kade.rider.locations"),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()))
	if err != nil {
		t.Fatal(err)
	}
	defer consumer.Close()
	poll(ctx, consumer, 2*time.Second) // join and position at the end

	stream, err := client.StreamRiderLocations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	pings := []*locationv1.RiderLocation{
		{RiderId: rider, Sequence: 1, Position: &commonv1.GeoPoint{Lat: 6.9110, Lng: 79.8490}, OccurredAt: timestamppb.New(now.Add(-2 * time.Second))},
		{RiderId: rider, Sequence: 1, Position: &commonv1.GeoPoint{Lat: 6.9110, Lng: 79.8490}, OccurredAt: timestamppb.New(now.Add(-2 * time.Second))}, // duplicate
		{RiderId: rider, Sequence: 2, Position: &commonv1.GeoPoint{Lat: 6.9112, Lng: 79.8491}, OccurredAt: timestamppb.New(now.Add(-time.Second)), Activity: locationv1.RiderActivity_RIDER_ACTIVITY_IDLE},
	}
	for _, p := range pings {
		if err := stream.Send(&locationv1.StreamRiderLocationsRequest{Location: p}); err != nil {
			t.Fatal(err)
		}
	}
	summary, err := stream.CloseAndRecv()
	if err != nil || summary.Accepted != 2 || summary.Dropped != 1 {
		t.Fatalf("summary = %v err %v", summary, err)
	}

	last, err := client.GetLastKnownLocation(ctx, &locationv1.GetLastKnownLocationRequest{RiderId: rider})
	if err != nil || last.GetLocation().GetSequence() != 2 || last.GetLocation().GetReceivedAt() == nil {
		t.Fatalf("last = %v err %v", last, err)
	}
	box, err := client.BatchGetLastKnownLocations(ctx, &locationv1.BatchGetLastKnownLocationsRequest{
		SouthWest: &commonv1.GeoPoint{Lat: 6.90, Lng: 79.84}, NorthEast: &commonv1.GeoPoint{Lat: 6.92, Lng: 79.86},
	})
	if err != nil || !containsRider(box.GetLocations(), rider) {
		t.Fatalf("box query missed the rider: %v %v", box, err)
	}
	if pos, err := a.Redis.GeoPos(ctx, positions.KeyGeo, rider).Result(); err != nil || len(pos) != 1 || pos[0] == nil {
		t.Fatalf("GEO position missing: %v %v", pos, err)
	}

	got := 0
	for got < 2 && ctx.Err() == nil {
		fs := poll(ctx, consumer, 5*time.Second)
		for _, r := range fs.Records() {
			if string(r.Key) != rider {
				continue
			}
			var loc locationv1.RiderLocation
			id, err := kafka.DecodeConfluent(r.Value, &loc)
			if err != nil || id != a.Stream.SchemaID() || loc.GetRiderId() != rider {
				t.Fatalf("record: schema %d err %v loc %v", id, err, &loc)
			}
			got++
		}
	}
	if got != 2 {
		t.Fatalf("got %d records for the rider on kade.rider.locations, want 2", got)
	}

	reg, _ := sr.NewClient(sr.URLs(st.SchemaRegistryURL))
	text, err := reg.SchemaTextByID(ctx, a.Stream.SchemaID())
	if err != nil || !strings.Contains(text, "message RiderLocation") {
		t.Fatalf("registered schema: %v\n%s", err, text)
	}
}

func TestReportBatch(t *testing.T) {
	rider := "it-" + uuid.NewString()
	defer a.Redis.HDel(context.Background(), positions.KeyLast, rider)
	defer a.Redis.ZRem(context.Background(), positions.KeyGeo, rider)
	defer a.Redis.ZRem(context.Background(), positions.KeySeen, rider)
	resp, err := client.ReportRiderLocations(context.Background(), &locationv1.ReportRiderLocationsRequest{Locations: []*locationv1.RiderLocation{
		{RiderId: rider, Sequence: 10, Position: &commonv1.GeoPoint{Lat: 6.8930, Lng: 79.8560}},
		{RiderId: rider, Sequence: 11, Position: &commonv1.GeoPoint{Lat: 0, Lng: 0}},
	}})
	if err != nil || resp.Accepted != 1 || resp.Dropped != 1 {
		t.Fatalf("report = %v err %v", resp, err)
	}
	batch, err := client.BatchGetLastKnownLocations(context.Background(), &locationv1.BatchGetLastKnownLocationsRequest{RiderIds: []string{rider}})
	if err != nil || len(batch.GetLocations()) != 1 {
		t.Fatalf("batch = %v err %v", batch, err)
	}
}

func containsRider(locs []*locationv1.RiderLocation, id string) bool {
	for _, l := range locs {
		if l.GetRiderId() == id {
			return true
		}
	}
	return false
}

func poll(ctx context.Context, cl *kgo.Client, d time.Duration) kgo.Fetches {
	c, cancel := context.WithTimeout(ctx, d)
	defer cancel()
	return cl.PollFetches(c)
}
