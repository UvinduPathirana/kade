// Package grpcx builds gRPC servers and clients with the Kadé defaults:
// OTel tracing/metrics (traceparent in metadata), identity from x-* metadata, panic recovery,
// apperr → status + ErrorInfo mapping, request logging, and deadlines on every call.
package grpcx

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"

	"github.com/UvinduPathirana/kade/services/_templates/go/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/_templates/go/internal/platform/auth"
)

type ServerOptions struct {
	Domain         string        // ErrorInfo.domain, use SERVICE_NAME
	Logger         *slog.Logger  //
	DefaultTimeout time.Duration // applied when the caller sent no deadline
}

// NewServer returns a server with interceptors, the standard health service and reflection
// (so grpcurl works in dev). Register your service on it, then Serve.
func NewServer(o ServerOptions) (*grpc.Server, *health.Server) {
	srv := grpc.NewServer(
		grpc.StatsHandler(otelgrpc.NewServerHandler()),
		// Outermost first: errors (log + map) wraps recovery wraps identity wraps deadline.
		grpc.ChainUnaryInterceptor(
			UnaryErrors(o.Domain, o.Logger),
			UnaryRecovery(o.Logger),
			UnaryIdentity(),
			UnaryDefaultDeadline(o.DefaultTimeout),
		),
		grpc.ChainStreamInterceptor(
			StreamErrors(o.Domain, o.Logger),
			StreamRecovery(o.Logger),
			StreamIdentity(),
		),
		grpc.KeepaliveParams(keepalive.ServerParameters{MaxConnectionIdle: 5 * time.Minute}),
	)
	hs := health.NewServer()
	healthpb.RegisterHealthServer(srv, hs)
	reflection.Register(srv)
	return srv, hs
}

// UnaryIdentity puts the gateway-provided identity into the context (auth.FromContext).
func UnaryIdentity() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
		md, _ := metadata.FromIncomingContext(ctx)
		return h(auth.WithIdentity(ctx, auth.FromMetadata(md)), req)
	}
}

// UnaryDefaultDeadline caps calls that arrive without a deadline so nothing runs forever.
func UnaryDefaultDeadline(d time.Duration) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
		if _, ok := ctx.Deadline(); !ok && d > 0 {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, d)
			defer cancel()
		}
		return h(ctx, req)
	}
}

// UnaryRecovery turns a panic into INTERNAL instead of killing the process.
func UnaryRecovery(log *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, h grpc.UnaryHandler) (resp any, err error) {
		defer func() {
			if r := recover(); r != nil {
				log.ErrorContext(ctx, "panic in handler", "method", info.FullMethod, "panic", r, "stack", string(debug.Stack()))
				err = apperr.New(codes.Internal, "INTERNAL", "internal error")
			}
		}()
		return h(ctx, req)
	}
}

// UnaryErrors logs the outcome and maps errors to status + ErrorInfo.
func UnaryErrors(domain string, log *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
		start := time.Now()
		resp, err := h(ctx, req)
		return resp, finish(ctx, log, domain, info.FullMethod, start, err)
	}
}

func finish(ctx context.Context, log *slog.Logger, domain, method string, start time.Time, err error) error {
	st := apperr.ToStatus(err, domain)
	attrs := []any{"method", method, "code", st.Code().String(), "duration_ms", time.Since(start).Milliseconds()}
	switch st.Code() {
	case codes.OK:
		log.DebugContext(ctx, "rpc", attrs...)
		return nil
	case codes.Internal, codes.Unknown, codes.DataLoss, codes.Unimplemented:
		log.ErrorContext(ctx, "rpc failed", append(attrs, "err", err)...)
	default:
		log.InfoContext(ctx, "rpc", append(attrs, "reason", apperr.Reason(st.Err()), "err", err)...)
	}
	return st.Err()
}

type wrappedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w wrappedStream) Context() context.Context { return w.ctx }

func StreamIdentity() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, h grpc.StreamHandler) error {
		md, _ := metadata.FromIncomingContext(ss.Context())
		return h(srv, wrappedStream{ss, auth.WithIdentity(ss.Context(), auth.FromMetadata(md))})
	}
}

func StreamRecovery(log *slog.Logger) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, h grpc.StreamHandler) (err error) {
		defer func() {
			if r := recover(); r != nil {
				log.ErrorContext(ss.Context(), "panic in stream", "method", info.FullMethod, "panic", r, "stack", string(debug.Stack()))
				err = apperr.New(codes.Internal, "INTERNAL", "internal error")
			}
		}()
		return h(srv, ss)
	}
}

func StreamErrors(domain string, log *slog.Logger) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, h grpc.StreamHandler) error {
		start := time.Now()
		return finish(ss.Context(), log, domain, info.FullMethod, start, h(srv, ss))
	}
}
