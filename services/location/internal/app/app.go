// Package app wires configuration, infrastructure clients and servers, runs them, and shuts them
// down in the right order. A new service mostly edits registerAPI and registerConsumers.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	"github.com/UvinduPathirana/kade/services/location/internal/config"
	"github.com/UvinduPathirana/kade/services/location/internal/note"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/db"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/health"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/redisx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/telemetry"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/ws"
	"github.com/UvinduPathirana/kade/services/location/migrations"
)

// App holds every long-lived dependency. Fields are exported for integration tests.
type App struct {
	Cfg    config.Config
	Log    *slog.Logger
	Tel    *telemetry.Telemetry
	Pool   *pgxpool.Pool
	Redis  *redis.Client // nil without REDIS_URL
	Geo    redisx.GeoIndex
	Hub    *ws.Hub
	Kafka  *kgo.Client // producer client (stream + DLQ); nil without KAFKA_BROKERS
	Stream *kafka.StreamProducer[*templatev1.Note]

	Health  *health.Checker
	grpcSrv *grpc.Server
	grpcHS  interface {
		SetServingStatus(string, healthpb.HealthCheckResponse_ServingStatus)
	}
	httpSrv  *http.Server
	consumer *kafka.Consumer
	broker   redisx.Broker

	GRPCAddr, HTTPAddr net.Addr // bound addresses (useful when ports are 0 in tests)
	grpcLis, httpLis   net.Listener
	closers            []func(context.Context) error
}

// New connects to everything and prepares servers, but serves nothing until Run.
// On error, everything opened so far is closed.
func New(ctx context.Context, cfg config.Config) (a *App, err error) {
	a = &App{Cfg: cfg, Health: health.New(2 * time.Second)}
	defer func() {
		if err != nil {
			a.close(context.Background())
		}
	}()

	if a.Tel, err = telemetry.Setup(ctx, telemetry.Options{
		ServiceName: cfg.ServiceName, Version: cfg.Version, OTLPEndpoint: cfg.OTLPEndpoint, LogLevel: cfg.LogLevel,
	}); err != nil {
		return a, fmt.Errorf("telemetry: %w", err)
	}
	a.Log = a.Tel.Logger
	a.closers = append(a.closers, a.Tel.Shutdown)

	// Postgres + migrations.
	if a.Pool, err = db.Open(ctx, cfg.DatabaseURL); err != nil {
		return a, err
	}
	a.closers = append(a.closers, func(context.Context) error { a.Pool.Close(); return nil })
	a.Health.Add("postgres", a.Pool.Ping)
	if cfg.MigrateOnStart {
		if err = db.Migrate(ctx, a.Pool, migrations.FS, a.Log); err != nil {
			return a, err
		}
	}

	// Redis: GEO index + WebSocket hub over pub/sub.
	if cfg.RedisURL != "" {
		if a.Redis, err = redisx.Open(ctx, cfg.RedisURL); err != nil {
			return a, err
		}
		a.closers = append(a.closers, func(context.Context) error { return a.Redis.Close() })
		a.Health.Add("redis", func(ctx context.Context) error { return a.Redis.Ping(ctx).Err() })
		a.Geo = redisx.NewGeoIndex(a.Redis, cfg.ServiceName+":geo:example")
		a.broker = redisx.NewBroker(ctx, a.Redis)
		a.closers = append(a.closers, func(context.Context) error { return a.broker.Close() })
		if a.Hub, err = ws.NewHub(ws.Options{Broker: a.broker, Logger: a.Log}); err != nil {
			return a, err
		}
	}

	// Kafka: producer client (stream + DLQ), optional registry stream, idempotent consumer.
	if len(cfg.KafkaBrokers) > 0 {
		if a.Kafka, err = kafka.NewProducerClient(cfg.KafkaBrokers, cfg.ServiceName, a.Log); err != nil {
			return a, err
		}
		a.closers = append(a.closers, func(ctx context.Context) error {
			err := a.Kafka.Flush(ctx) // deliver buffered stream records before exit
			a.Kafka.Close()
			return err
		})
		a.Health.Add("kafka", a.Kafka.Ping)

		if cfg.SchemaRegistryURL != "" {
			reg, err := sr.NewClient(sr.URLs(cfg.SchemaRegistryURL))
			if err != nil {
				return a, err
			}
			if a.Stream, err = retry(ctx, a.Log, "schema registry", func() (*kafka.StreamProducer[*templatev1.Note], error) {
				return kafka.NewStreamProducer[*templatev1.Note](ctx, a.Kafka, reg, cfg.StreamTopic)
			}); err != nil {
				return a, err
			}
			a.Log.InfoContext(ctx, "stream producer ready", "topic", cfg.StreamTopic, "schema_id", a.Stream.SchemaID())
		}

		router := kafka.NewRouter()
		a.registerConsumers(router)
		if a.consumer, err = kafka.NewConsumer(kafka.ConsumerOptions{
			Brokers: cfg.KafkaBrokers, Group: cfg.ServiceName, Topics: []string{cfg.NoteEventsTopic},
			Pool: a.Pool, Router: router, DLQ: a.Kafka, Logger: a.Log,
		}); err != nil {
			return a, err
		}
	}

	// gRPC.
	a.grpcSrv, a.grpcHS = grpcx.NewServer(grpcx.ServerOptions{Domain: cfg.ServiceName, Logger: a.Log, DefaultTimeout: cfg.RPCTimeout})
	a.registerAPI()

	// HTTP: health, metrics, WebSocket.
	mux := http.NewServeMux()
	mux.Handle("GET /health/live", a.Health.LiveHandler())
	mux.Handle("GET /health/ready", a.Health.ReadyHandler())
	mux.Handle("GET /metrics", a.Tel.MetricsHandler)
	if a.Hub != nil {
		mux.Handle("GET /ws", otelhttp.NewHandler(a.Hub, "GET /ws"))
	}
	a.httpSrv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	lc := net.ListenConfig{}
	if a.grpcLis, err = lc.Listen(ctx, "tcp", ":"+strconv.Itoa(cfg.GRPCPort)); err != nil {
		return a, err
	}
	if a.httpLis, err = lc.Listen(ctx, "tcp", ":"+strconv.Itoa(cfg.HTTPPort)); err != nil {
		_ = a.grpcLis.Close()
		return a, err
	}
	a.GRPCAddr, a.HTTPAddr = a.grpcLis.Addr(), a.httpLis.Addr()
	return a, nil
}

// registerAPI registers gRPC services. Add yours here.
func (a *App) registerAPI() {
	var views note.ViewSink
	if a.Stream != nil {
		views = func(ctx context.Context, n *templatev1.Note) {
			a.Stream.Produce(ctx, n.GetId(), n, func(_ *kgo.Record, err error) {
				if err != nil {
					a.Log.WarnContext(ctx, "stream produce failed", "topic", a.Stream.Topic(), "err", err)
				}
			})
		}
	}
	templatev1.RegisterTemplateServiceServer(a.grpcSrv, note.NewService(note.NewPgStore(a.Pool), views))
}

// registerConsumers maps event types to handlers. Add yours here.
func (a *App) registerConsumers(r *kafka.Router) {
	var pub note.Publisher
	if a.Hub != nil {
		pub = a.Hub
	}
	note.RegisterHandlers(r, pub, a.Log)
}

// Run serves until ctx is cancelled (SIGTERM) or a component fails, then shuts down gracefully:
// readiness fails first, then gRPC drains in-flight calls, HTTP and WebSockets close, the
// consumer commits and leaves its group, buffered records are flushed, connections close.
func (a *App) Run(ctx context.Context) error {
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		if err := a.grpcSrv.Serve(a.grpcLis); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			return fmt.Errorf("grpc: %w", err)
		}
		return nil
	})
	g.Go(func() error {
		if err := a.httpSrv.Serve(a.httpLis); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("http: %w", err)
		}
		return nil
	})
	consumerCtx, stopConsumer := context.WithCancel(context.WithoutCancel(gctx))
	defer stopConsumer()
	consumerDone := make(chan struct{})
	if a.consumer != nil {
		go func() { defer close(consumerDone); _ = a.consumer.Run(consumerCtx) }()
	} else {
		close(consumerDone)
	}
	hubCtx, stopHub := context.WithCancel(context.WithoutCancel(gctx))
	defer stopHub()
	if a.Hub != nil {
		go func() { _ = a.Hub.Run(hubCtx) }()
	}
	a.grpcHS.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	a.Log.InfoContext(ctx, "service started", "grpc", a.GRPCAddr.String(), "http", a.HTTPAddr.String(), "version", a.Cfg.Version)

	g.Go(func() error {
		<-gctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), a.Cfg.ShutdownTimeout)
		defer cancel()
		a.Log.InfoContext(sctx, "shutting down")
		a.Health.SetDraining()
		a.grpcHS.SetServingStatus("", healthpb.HealthCheckResponse_NOT_SERVING)

		stopped := make(chan struct{})
		go func() { a.grpcSrv.GracefulStop(); close(stopped) }()
		select {
		case <-stopped:
		case <-sctx.Done():
			a.grpcSrv.Stop()
		}
		if a.Hub != nil {
			_ = a.Hub.Shutdown(sctx)
		}
		_ = a.httpSrv.Shutdown(sctx)
		stopConsumer()
		select {
		case <-consumerDone:
		case <-sctx.Done():
		}
		stopHub()
		return a.close(sctx)
	})
	err := g.Wait()
	a.Log.Info("stopped", "err", err)
	return err
}

func (a *App) close(ctx context.Context) error {
	var errs []error
	for i := len(a.closers) - 1; i >= 0; i-- {
		errs = append(errs, a.closers[i](ctx))
	}
	a.closers = nil
	return errors.Join(errs...)
}

// retry calls fn until it succeeds (dependencies may still be starting), up to ~30s.
func retry[T any](ctx context.Context, log *slog.Logger, what string, fn func() (T, error)) (T, error) {
	var zero T
	for attempt := 1; ; attempt++ {
		v, err := fn()
		if err == nil {
			return v, nil
		}
		if attempt == 15 || ctx.Err() != nil {
			return zero, fmt.Errorf("%s: %w", what, err)
		}
		log.WarnContext(ctx, "dependency not ready, retrying", "dependency", what, "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}
