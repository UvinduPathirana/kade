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
	"strings"
	"time"

	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
	"github.com/UvinduPathirana/kade/services/realtime/internal/config"
	"github.com/UvinduPathirana/kade/services/realtime/internal/fanout"
	"github.com/UvinduPathirana/kade/services/realtime/internal/hub"
	"github.com/UvinduPathirana/kade/services/realtime/internal/identity"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/auth"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/health"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/redisx"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/telemetry"
	"github.com/UvinduPathirana/kade/services/realtime/internal/views"
)

// App holds every long-lived dependency. Fields are exported for integration tests.
type App struct {
	Cfg    config.Config
	Log    *slog.Logger
	Tel    *telemetry.Telemetry
	Redis  *redis.Client
	Views  *views.Store
	Hub    *hub.Hub
	Fanout *fanout.Service
	Kafka  *kgo.Client // producer client (DLQ)

	Health   *health.Checker
	httpSrv  *http.Server
	consumer *kafka.Consumer
	broker   redisx.Broker

	HTTPAddr net.Addr // bound address (useful when the port is 0 in tests)
	httpLis  net.Listener
	closers  []func(context.Context) error
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

	// Redis: pub/sub fan-out, views, dedup.
	if a.Redis, err = redisx.Open(ctx, cfg.RedisURL); err != nil {
		return a, err
	}
	a.closers = append(a.closers, func(context.Context) error { return a.Redis.Close() })
	a.Health.Add("redis", func(ctx context.Context) error { return a.Redis.Ping(ctx).Err() })
	a.Views = views.New(a.Redis, cfg.RedisPrefix, cfg.ViewTTL)
	a.broker = redisx.NewBroker(ctx, a.Redis)
	a.closers = append(a.closers, func(context.Context) error { return a.broker.Close() })

	// Authorisation: ownership index in Redis, order service as fallback for unseen orders.
	authz := &channel.Authorizer{Owners: a.Views}
	if cfg.OrderGRPC != "" {
		conn, err := grpcx.Dial(cfg.OrderGRPC, grpcx.WithRetryableMethods("kade.order.v1.OrderService/GetOrder"))
		if err != nil {
			return a, err
		}
		a.closers = append(a.closers, func(context.Context) error { return conn.Close() })
		authz.Lookup = orderLookup(conn)
	}
	if a.Hub, err = hub.New(hub.Options{
		Broker: a.broker, Redis: a.Redis, Prefix: cfg.RedisPrefix, Logger: a.Log, Authorize: authz.Authorize,
		DevBypass: cfg.DevBypass, OriginPatterns: cfg.OriginPatterns, SendBuffer: cfg.SendBuffer,
		WriteTimeout: cfg.WriteTimeout, PingInterval: cfg.PingInterval, MaxSubscriptions: cfg.MaxSubscriptions,
		ReplayWindow: cfg.ReplayWindow,
	}); err != nil {
		return a, err
	}
	a.Fanout = fanout.New(fanout.Options{
		Views: a.Views, Publisher: a.Hub, Logger: a.Log,
		StaleAfter: cfg.StaleAfter, PositionInterval: cfg.PositionInterval,
	})

	// Kafka: ONE consumer group shared by all replicas; Redis pub/sub does the fan-out.
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
	a.Fanout.Register(router)
	if a.consumer, err = kafka.NewConsumer(kafka.ConsumerOptions{
		Brokers: cfg.KafkaBrokers, Group: cfg.KafkaGroup, Topics: cfg.Topics,
		Dedup: a.Views, Router: router, DLQ: a.Kafka, Logger: a.Log,
		Raw: map[string]kafka.RawHandler{cfg.LocationsTopic: a.Fanout.HandleLocation},
	}); err != nil {
		return a, err
	}

	// HTTP: WebSocket, health, metrics.
	mux := http.NewServeMux()
	mux.Handle("GET /health/live", a.Health.LiveHandler())
	mux.Handle("GET /health/ready", a.Health.ReadyHandler())
	mux.Handle("GET /metrics", a.Tel.MetricsHandler)
	mux.Handle("GET /ws", otelhttp.NewHandler(a.Hub, "GET /ws"))
	a.httpSrv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	lc := net.ListenConfig{}
	if a.httpLis, err = lc.Listen(ctx, "tcp", ":"+strconv.Itoa(cfg.HTTPPort)); err != nil {
		return a, err
	}
	a.HTTPAddr = a.httpLis.Addr()
	return a, nil
}

// orderLookup asks order.GetOrder as the caller; the order service applies its own authorisation.
func orderLookup(conn *grpc.ClientConn) channel.OrderLookup {
	client := orderv1.NewOrderServiceClient(conn)
	return func(ctx context.Context, id identity.Identity, orderID string) (channel.OrderAccess, bool, error) {
		caller := auth.Identity{UserID: id.UserID, Roles: id.Roles}
		if len(id.OutletIDs) > 0 {
			caller.OutletID = id.OutletIDs[0]
		}
		res, err := client.GetOrder(auth.WithIdentity(ctx, caller), &orderv1.GetOrderRequest{OrderId: orderID})
		switch status.Code(err) {
		case codes.OK:
		case codes.NotFound, codes.PermissionDenied, codes.InvalidArgument, codes.Unauthenticated:
			return channel.OrderAccess{}, false, nil
		default:
			return channel.OrderAccess{}, false, err
		}
		o := res.GetOrder()
		return channel.OrderAccess{CustomerID: o.GetCustomer().GetId(), OutletID: o.GetRestaurant().GetId(), RiderID: o.GetRider().GetRiderId()}, o.GetId() != "", nil
	}
}

// Run serves until ctx is cancelled (SIGTERM) or a component fails, then shuts down gracefully:
// readiness fails first, sockets close with 1001 (clients reconnect to another replica), HTTP
// stops, the consumer finishes its batch, commits and leaves the group, connections close.
func (a *App) Run(ctx context.Context) error {
	errc := make(chan error, 1)
	go func() {
		if err := a.httpSrv.Serve(a.httpLis); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errc <- fmt.Errorf("http: %w", err)
		}
	}()
	bg, stopBg := context.WithCancel(context.WithoutCancel(ctx))
	defer stopBg()
	consumerCtx, stopConsumer := context.WithCancel(bg)
	defer stopConsumer()
	consumerDone := make(chan struct{})
	go func() { defer close(consumerDone); _ = a.consumer.Run(consumerCtx) }()
	go func() { _ = a.Hub.Run(bg) }()
	go a.Fanout.RunOps(bg, a.Cfg.OpsInterval)
	a.Log.InfoContext(ctx, "service started", "http", a.HTTPAddr.String(), "group", a.Cfg.KafkaGroup,
		"topics", strings.Join(a.Cfg.Topics, ","), "dev_bypass", a.Cfg.DevBypass, "version", a.Cfg.Version)

	var runErr error
	select {
	case <-ctx.Done():
	case runErr = <-errc:
	}
	sctx, cancel := context.WithTimeout(context.Background(), a.Cfg.ShutdownTimeout)
	defer cancel()
	a.Log.InfoContext(sctx, "shutting down")
	a.Health.SetDraining()
	_ = a.Hub.Shutdown(sctx)
	_ = a.httpSrv.Shutdown(sctx)
	stopConsumer()
	select {
	case <-consumerDone:
	case <-sctx.Done():
	}
	stopBg()
	err := errors.Join(runErr, a.close(sctx))
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
