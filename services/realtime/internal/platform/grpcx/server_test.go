package grpcx

import (
	"context"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/auth"
)

// stub lets each test decide what GetNote does.
type stub struct {
	templatev1.UnimplementedTemplateServiceServer
	get func(context.Context, *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error)
}

func (s *stub) GetNote(ctx context.Context, r *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
	return s.get(ctx, r)
}

func start(t *testing.T, s *stub, timeout time.Duration) templatev1.TemplateServiceClient {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	srv, _ := NewServer(ServerOptions{Domain: "test-svc", Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), DefaultTimeout: timeout})
	templatev1.RegisterTemplateServiceServer(srv, s)
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	conn, err := Dial("passthrough:///bufnet", WithDialOptions(grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return lis.DialContext(ctx)
	})))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return templatev1.NewTemplateServiceClient(conn)
}

func TestIdentityFromMetadata(t *testing.T) {
	var got auth.Identity
	c := start(t, &stub{get: func(ctx context.Context, _ *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
		got = auth.FromContext(ctx)
		return &templatev1.GetNoteResponse{}, nil
	}}, time.Second)
	ctx := metadata.AppendToOutgoingContext(context.Background(), "x-user-id", "u1", "x-roles", "merchant_staff, merchant_owner", "x-outlet-id", "o9")
	if _, err := c.GetNote(ctx, &templatev1.GetNoteRequest{}); err != nil {
		t.Fatal(err)
	}
	if got.UserID != "u1" || got.OutletID != "o9" || !got.HasRole("merchant_owner") || got.HasRole("admin") {
		t.Fatalf("identity = %+v", got)
	}
}

func TestClientForwardsIdentity(t *testing.T) {
	var got auth.Identity
	c := start(t, &stub{get: func(ctx context.Context, _ *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
		got = auth.FromContext(ctx)
		return &templatev1.GetNoteResponse{}, nil
	}}, time.Second)
	// A service handling a request calls another service: identity flows along.
	ctx := auth.WithIdentity(context.Background(), auth.Identity{UserID: "u2", Roles: []string{"rider"}})
	if _, err := c.GetNote(ctx, &templatev1.GetNoteRequest{}); err != nil {
		t.Fatal(err)
	}
	if got.UserID != "u2" || !got.HasRole("rider") {
		t.Fatalf("identity = %+v", got)
	}
}

func TestErrorMappingAndRecovery(t *testing.T) {
	cases := map[string]struct {
		fn     func() error
		code   codes.Code
		reason string
	}{
		"app error": {func() error { return apperr.NotFound("NOTE_NOT_FOUND", "x") }, codes.NotFound, "NOTE_NOT_FOUND"},
		"panic":     {func() error { panic("boom") }, codes.Internal, "INTERNAL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			c := start(t, &stub{get: func(context.Context, *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
				return nil, tc.fn()
			}}, time.Second)
			_, err := c.GetNote(context.Background(), &templatev1.GetNoteRequest{})
			if status.Code(err) != tc.code || apperr.Reason(err) != tc.reason {
				t.Fatalf("err = %v (reason %q)", err, apperr.Reason(err))
			}
		})
	}
}

func TestDeadlines(t *testing.T) {
	var serverDeadline time.Duration
	c := start(t, &stub{get: func(ctx context.Context, _ *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
		dl, ok := ctx.Deadline()
		if !ok {
			t.Error("handler ran without a deadline")
		}
		serverDeadline = time.Until(dl)
		return &templatev1.GetNoteResponse{}, nil
	}}, 50*time.Millisecond)
	if _, err := c.GetNote(context.Background(), &templatev1.GetNoteRequest{}); err != nil {
		t.Fatal(err)
	}
	// The client default (2s) wins over nothing; it reaches the server through grpc-timeout.
	if serverDeadline < time.Second || serverDeadline > DefaultCallTimeout {
		t.Fatalf("server saw deadline %v, want ~%v from the client default", serverDeadline, DefaultCallTimeout)
	}

	// Server-side cap when a caller sends no deadline at all.
	slow := start(t, &stub{get: func(ctx context.Context, _ *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}, 50*time.Millisecond)
	_, err := slow.GetNote(context.Background(), &templatev1.GetNoteRequest{})
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("err = %v, want DeadlineExceeded", err)
	}
}

func TestServiceConfigRetry(t *testing.T) {
	cfg := serviceConfig([]string{"/kade.catalog.v1.CatalogService/GetMenu"})
	for _, want := range []string{`"service":"kade.catalog.v1.CatalogService"`, `"method":"GetMenu"`, `"UNAVAILABLE"`} {
		if !strings.Contains(cfg, want) {
			t.Errorf("service config %s missing %s", cfg, want)
		}
	}
}
