// Package app wires configuration, infrastructure clients and servers, runs them, and shuts them
// down in the right order.
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

	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	notificationv1 "github.com/UvinduPathirana/kade/gen/go/kade/notification/v1"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"
	"golang.org/x/sync/errgroup"
	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/config"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/dispatch"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/db"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/health"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/redisx"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/telemetry"
	"github.com/UvinduPathirana/kade/services/dispatch/migrations"
)

// App holds every long-lived dependency. Fields are exported for integration tests.
type App struct {
	Cfg   config.Config
	Log   *slog.Logger
	Tel   *telemetry.Telemetry
	Pool  *pgxpool.Pool
	Redis *redis.Client
	Kafka *kgo.Client // producer client (DLQ); nil without KAFKA_BROKERS
	Core  *dispatch.Core
	Sim   *dispatch.Simulator // nil unless SIMULATE_RIDERS

	Health  *health.Checker
	grpcSrv *grpc.Server
	grpcHS  interface {
		SetServingStatus(string, healthpb.HealthCheckResponse_ServingStatus)
	}
	httpSrv   *http.Server
	consumer  *kafka.Consumer
	locations *kgo.Client // kade.rider.locations consumer

	GRPCAddr, HTTPAddr net.Addr
	grpcLis, httpLis   net.Listener
	closers            []func(context.Context) error
}

// New connects to everything, migrates and seeds, and prepares servers; serves nothing until Run.
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

	if a.Redis, err = redisx.Open(ctx, cfg.RedisURL); err != nil {
		return a, err
	}
	a.closers = append(a.closers, func(context.Context) error { return a.Redis.Close() })
	a.Health.Add("redis", func(ctx context.Context) error { return a.Redis.Ping(ctx).Err() })

	a.Core = dispatch.NewCore(a.Pool, dispatch.NewFleet(a.Redis), dispatch.Options{
		OfferTimeout: cfg.OfferTimeout, RadiiKm: cfg.MatchRadiiKm, MatchFailAfter: cfg.MatchFailAfter, ReofferAfter: cfg.ReofferAfter,
		RiderStaleAfter: cfg.RiderStaleAfter, PreferReal: cfg.PreferRealRiders, MaxEventAge: cfg.MaxEventAge,
	}, a.Log)
	if err = a.dialDependencies(); err != nil {
		return a, err
	}
	if cfg.SeedOnStart {
		if err = a.Core.Seed(ctx); err != nil {
			return a, fmt.Errorf("seed: %w", err)
		}
	}
	if cfg.SimulateRiders {
		a.Sim = dispatch.NewSimulator(a.Core, cfg.SimSecondsPerKm, cfg.SimAcceptDelay)
	}

	if len(cfg.KafkaBrokers) > 0 {
		if a.Kafka, err = kafka.NewProducerClient(cfg.KafkaBrokers, cfg.ServiceName, a.Log); err != nil {
			return a, err
		}
		a.closers = append(a.closers, func(ctx context.Context) error {
			err := a.Kafka.Flush(ctx)
			a.Kafka.Close()
			return err
		})
		a.Health.Add("kafka", a.Kafka.Ping)

		router := kafka.NewRouter()
		a.Core.RegisterHandlers(router)
		if a.consumer, err = kafka.NewConsumer(kafka.ConsumerOptions{
			Brokers: cfg.KafkaBrokers, Group: cfg.ServiceName, Topics: cfg.EventTopics,
			Pool: a.Pool, Router: router, DLQ: a.Kafka, Logger: a.Log,
		}); err != nil {
			return a, err
		}
		if cfg.LocationsTopic != "" {
			// Positions are not business events: own group, start at the end, no DLQ.
			if a.locations, err = kgo.NewClient(
				kgo.SeedBrokers(cfg.KafkaBrokers...),
				kgo.ClientID(cfg.ServiceName+"-locations"),
				kgo.ConsumerGroup(cfg.ServiceName+"-locations"),
				kgo.ConsumeTopics(cfg.LocationsTopic),
				kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()),
				kgo.FetchMaxBytes(2<<20), kgo.FetchMaxPartitionBytes(256<<10),
				kgo.WithLogger(kafka.Logger(a.Log)),
			); err != nil {
				return a, err
			}
		}
	}

	a.grpcSrv, a.grpcHS = grpcx.NewServer(grpcx.ServerOptions{Domain: cfg.ServiceName, Logger: a.Log, DefaultTimeout: cfg.RPCTimeout})
	dispatchv1.RegisterDispatchServiceServer(a.grpcSrv, dispatch.NewDispatchAPI(a.Core))
	dispatchv1.RegisterDispatchOpsServiceServer(a.grpcSrv, dispatch.NewOpsAPI(a.Core))
	dispatchv1.RegisterRiderServiceServer(a.grpcSrv, dispatch.NewRiderAPI(a.Core))

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

// dialDependencies connects the optional gRPC clients (lazy connections: nothing fails if the
// other service is down; calls just error and are logged).
func (a *App) dialDependencies() error {
	if a.Cfg.LocationGRPC != "" {
		conn, err := grpcx.Dial(a.Cfg.LocationGRPC)
		if err != nil {
			return err
		}
		a.closers = append(a.closers, func(context.Context) error { return conn.Close() })
		loc := locationv1.NewLocationServiceClient(conn)
		a.Core.Reporter = func(ctx context.Context, locs []*locationv1.RiderLocation) error {
			_, err := loc.ReportRiderLocations(ctx, &locationv1.ReportRiderLocationsRequest{Locations: locs})
			return err
		}
	}
	if a.Cfg.NotificationGRPC != "" {
		conn, err := grpcx.Dial(a.Cfg.NotificationGRPC)
		if err != nil {
			return err
		}
		a.closers = append(a.closers, func(context.Context) error { return conn.Close() })
		n := notificationv1.NewNotificationServiceClient(conn)
		a.Core.Messenger = func(ctx context.Context, d *dispatch.DeliveryRow, riderFirstName, text, messageID string) error {
			_, err := n.SendNotification(ctx, &notificationv1.SendNotificationRequest{
				Channel:   notificationv1.Channel_CHANNEL_SMS,
				Recipient: &notificationv1.Recipient{Kind: notificationv1.RecipientKind_RECIPIENT_KIND_CUSTOMER, UserId: d.CustomerID, Name: d.D.GetDropoff().GetFirstName()},
				Template:  "rider_message",
				Params: map[string]string{
					"text": text, "rider_first_name": riderFirstName, "order_number": d.D.GetOrderNumber(), "masked_phone": d.D.GetDropoff().GetMaskedPhone(),
				},
				ReferenceId: d.D.GetOrderId(), Transactional: true, IdempotencyKey: "rider-message-" + messageID,
			})
			return err
		}
	}
	return nil
}

// Run serves until ctx is cancelled (SIGTERM) or a component fails, then shuts down gracefully.
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

	// Background loops: stopped after gRPC has drained, before connections close.
	bgCtx, stopBg := context.WithCancel(context.WithoutCancel(gctx))
	defer stopBg()
	var bg errgroup.Group
	if err := a.Core.Reconcile(bgCtx); err != nil {
		a.Log.WarnContext(ctx, "initial GEO reconcile failed", "err", err)
	}
	bg.Go(func() error { a.Core.RunMatcher(bgCtx); return nil })
	bg.Go(func() error { a.Core.RunReconciler(bgCtx, time.Minute); return nil })
	if a.Sim != nil {
		bg.Go(func() error { a.Sim.Run(bgCtx); return nil })
	}
	if a.consumer != nil {
		bg.Go(func() error { return a.consumer.Run(bgCtx) })
	}
	if a.locations != nil {
		bg.Go(func() error { a.Core.ConsumeLocations(bgCtx, a.locations); return nil })
	}

	a.grpcHS.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	a.Log.InfoContext(ctx, "service started", "grpc", a.GRPCAddr.String(), "http", a.HTTPAddr.String(), "version", a.Cfg.Version,
		"simulate_riders", a.Sim != nil)

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
		stopBg()
		done := make(chan struct{})
		go func() { _ = bg.Wait(); close(done) }()
		select {
		case <-done:
		case <-sctx.Done():
		}
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
