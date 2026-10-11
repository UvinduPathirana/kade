package grpcx

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/auth"
)

// DefaultCallTimeout is the convention's deadline for every outgoing call.
const DefaultCallTimeout = 2 * time.Second

type clientOptions struct {
	timeout       time.Duration
	retryMethods  []string
	extraDialOpts []grpc.DialOption
}

type ClientOption func(*clientOptions)

// WithCallTimeout overrides the 2 s default deadline (only applied when ctx has none).
func WithCallTimeout(d time.Duration) ClientOption { return func(o *clientOptions) { o.timeout = d } }

// WithRetryableMethods enables transparent retries (UNAVAILABLE only, 3 attempts) for idempotent
// reads, e.g. "kade.catalog.v1.CatalogService/GetMenu". Never list mutating RPCs.
func WithRetryableMethods(fullMethods ...string) ClientOption {
	return func(o *clientOptions) { o.retryMethods = append(o.retryMethods, fullMethods...) }
}

func WithDialOptions(opts ...grpc.DialOption) ClientOption {
	return func(o *clientOptions) { o.extraDialOpts = append(o.extraDialOpts, opts...) }
}

// Dial connects to another Kadé service (target from <NAME>_GRPC, e.g. "catalog:50101").
// The connection is lazy; create it once at startup and share it.
func Dial(target string, opts ...ClientOption) (*grpc.ClientConn, error) {
	o := clientOptions{timeout: DefaultCallTimeout}
	for _, fn := range opts {
		fn(&o)
	}
	dialOpts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()), // mTLS comes with Linkerd later
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
		grpc.WithChainUnaryInterceptor(forwardIdentity(), defaultDeadline(o.timeout)),
		grpc.WithDefaultServiceConfig(serviceConfig(o.retryMethods)),
	}
	return grpc.NewClient(target, append(dialOpts, o.extraDialOpts...)...)
}

func forwardIdentity() grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, inv grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		return inv(auth.AppendToOutgoing(ctx, auth.FromContext(ctx)), method, req, reply, cc, opts...)
	}
}

func defaultDeadline(d time.Duration) grpc.UnaryClientInterceptor {
	return func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, inv grpc.UnaryInvoker, opts ...grpc.CallOption) error {
		if _, ok := ctx.Deadline(); !ok && d > 0 {
			var cancel context.CancelFunc
			ctx, cancel = context.WithTimeout(ctx, d)
			defer cancel()
		}
		return inv(ctx, method, req, reply, cc, opts...)
	}
}

func serviceConfig(retryMethods []string) string {
	type name struct {
		Service string `json:"service"`
		Method  string `json:"method,omitempty"`
	}
	cfg := map[string]any{"loadBalancingConfig": []any{map[string]any{"round_robin": map[string]any{}}}}
	if len(retryMethods) > 0 {
		var names []name
		for _, m := range retryMethods {
			svc, meth, _ := strings.Cut(strings.TrimPrefix(m, "/"), "/")
			names = append(names, name{svc, meth})
		}
		cfg["methodConfig"] = []any{map[string]any{
			"name": names,
			"retryPolicy": map[string]any{
				"maxAttempts":          3,
				"initialBackoff":       "0.1s",
				"maxBackoff":           "1s",
				"backoffMultiplier":    2,
				"retryableStatusCodes": []string{"UNAVAILABLE"},
			},
		}}
	}
	b, _ := json.Marshal(cfg)
	return string(b)
}
