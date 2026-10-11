// Package app wires configuration, infrastructure clients and servers, runs them, and shuts them
// down in the right order. location has no database: it is a stream producer plus a Redis cache
// of last known positions.
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

	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	"github.com/UvinduPathirana/kade/services/location/internal/config"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/health"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/redisx"
	"github.com/UvinduPathirana/kade/services/location/internal/platform/telemetry"
	"github.com/UvinduPathirana/kade/services/location/internal/positions"
)

// App holds every long-lived dependency. Fields are exported for integration tests.
type App struct {
	Cfg     config.Config
	Log     *slog.Logger
	Tel     *telemetry.Telemetry
	Redis   *redis.Client
	Kafka   *kgo.Client
	Stream  *kafka.StreamProducer[*locationv1.RiderLocation]
	Service *positions.Service

	Health  *health.Checker
	grpcSrv *grpc.Server
	grpcHS  interface {
		SetServingStatus(string, healthpb.HealthCheckResponse_ServingStatus)
	}
	httpSrv *http.Server

	GRPCAddr, HTTPAddr net.Addr
	grpcLis, httpLis   net.Listener
	closers            []func(context.Context) error
}

// New connects to everything and prepares servers, but serves nothing until Run.
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

	if a.Redis, err = redisx.Open(ctx, cfg.RedisURL); err != nil {
		return a, err
	}
	a.closers = append(a.closers, func(context.Context) error { return a.Redis.Close() })
	a.Health.Add("redis", func(ctx context.Context) error { return a.Redis.Ping(ctx).Err() })

	if a.Kafka, err = kafka.NewProducerClient(cfg.KafkaBrokers, cfg.ServiceName, a.Log); err != nil {
		return a, err
	}
	a.closers = append(a.closers, func(ctx context.Context) error {
		err := a.Kafka.Flush(ctx) // deliver buffered positions before exit
		a.Kafka.Close()
		return err
	})
	a.Health.Add("kafka", a.Kafka.Ping)

	reg, err := sr.NewClient(sr.URLs(cfg.SchemaRegistryURL))
	if err != nil {
		return a, err
	}
	if a.Stream, err = retry(ctx, a.Log, "schema registry", func() (*kafka.StreamProducer[*locationv1.RiderLocation], error) {
		return kafka.NewStreamProducer[*locationv1.RiderLocation](ctx, a.Kafka, reg, cfg.StreamTopic)
	}); err != nil {
		return a, err
	}
	a.Log.InfoContext(ctx, "stream producer ready", "topic", cfg.StreamTopic, "schema_id", a.Stream.SchemaID())

	sink := func(ctx context.Context, l *locationv1.RiderLocation) {
		a.Stream.Produce(ctx, l.GetRiderId(), l, func(_ *kgo.Record, err error) {
			if err != nil {
				a.Log.WarnContext(ctx, "position produce failed", "rider_id", l.GetRiderId(), "err", err)
			}
		})
	}
	a.Service = positions.NewService(positions.NewFilter(cfg.MaxSpeedMPS), positions.NewRedisStore(a.Redis), sink, cfg.LastKnownTTL, a.Log)

	a.grpcSrv, a.grpcHS = grpcx.NewServer(grpcx.ServerOptions{Domain: cfg.ServiceName, Logger: a.Log, DefaultTimeout: cfg.RPCTimeout})
	locationv1.RegisterLocationServiceServer(a.grpcSrv, a.Service)

	mux := http.NewServeMux()
	mux.Handle("GET /health/live", a.Health.LiveHandler())
	mux.Handle("GET /health/ready", a.Health.ReadyHandler())
	mux.Handle("GET /metrics", a.Tel.MetricsHandler)
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

// Run serves until ctx is cancelled, then shuts down: readiness fails, gRPC drains (open client
// streams get their summary), HTTP stops, buffered positions are flushed, connections close.
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
	janitorCtx, stopJanitor := context.WithCancel(context.WithoutCancel(gctx))
	defer stopJanitor()
	go a.Service.RunJanitor(janitorCtx, time.Minute, a.Cfg.RetainPositions)

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
		_ = a.httpSrv.Shutdown(sctx)
		stopJanitor()
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
