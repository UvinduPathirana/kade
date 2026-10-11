package ws

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/redisx"
)

// memBroker is an in-process stand-in for Redis pub/sub.
type memBroker struct {
	mu   sync.Mutex
	subs map[string]int
	out  chan redisx.Message
}

func newMemBroker() *memBroker {
	return &memBroker{subs: map[string]int{}, out: make(chan redisx.Message, 16)}
}

func (b *memBroker) Publish(_ context.Context, ch string, p []byte) error {
	b.mu.Lock()
	subscribed := b.subs[ch] > 0
	b.mu.Unlock()
	if subscribed {
		b.out <- redisx.Message{Channel: ch, Payload: p}
	}
	return nil
}
func (b *memBroker) Subscribe(_ context.Context, chs ...string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, c := range chs {
		b.subs[c]++
	}
	return nil
}
func (b *memBroker) Unsubscribe(_ context.Context, chs ...string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, c := range chs {
		b.subs[c]--
	}
	return nil
}
func (b *memBroker) Messages() <-chan redisx.Message { return b.out }
func (b *memBroker) Close() error                    { return nil }
func (b *memBroker) subscriptions(ch string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.subs[ch]
}

func setup(t *testing.T, o Options) (*Hub, *memBroker, string) {
	t.Helper()
	b := newMemBroker()
	o.Broker, o.Logger = b, slog.New(slog.NewTextHandler(io.Discard, nil))
	h, err := NewHub(o)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go h.Run(ctx)
	srv := httptest.NewServer(h)
	t.Cleanup(func() { cancel(); srv.Close() })
	return h, b, "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func read(t *testing.T, c *websocket.Conn) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHubFanOut(t *testing.T) {
	h, b, url := setup(t, Options{})
	a1 := dial(t, url+"?channel=order:1")
	a2 := dial(t, url+"?channel=order:1&channel=order:2")
	waitFor(t, func() bool { return h.Subscribers("order:1") == 2 })
	if b.subscriptions("order:1") != 1 {
		t.Fatalf("broker subscriptions = %d, want one shared subscription", b.subscriptions("order:1"))
	}

	_ = h.Publish(context.Background(), "order:1", []byte(`{"status":"picked_up"}`))
	if got := read(t, a1); got != `{"status":"picked_up"}` {
		t.Fatalf("a1 got %q", got)
	}
	if got := read(t, a2); got != `{"status":"picked_up"}` {
		t.Fatalf("a2 got %q", got)
	}
	_ = h.Publish(context.Background(), "order:2", []byte("two"))
	if got := read(t, a2); got != "two" {
		t.Fatalf("a2 got %q", got)
	}

	// Unsubscribe from Redis once the last local client leaves.
	a1.Close(websocket.StatusNormalClosure, "")
	a2.Close(websocket.StatusNormalClosure, "")
	waitFor(t, func() bool { return b.subscriptions("order:1") == 0 && b.subscriptions("order:2") == 0 })
}

func TestHubRejectsBadChannels(t *testing.T) {
	_, _, url := setup(t, Options{Authorize: func(_ *http.Request, ch string) bool { return !strings.HasPrefix(ch, "admin:") }})
	httpURL := "http" + strings.TrimPrefix(url, "ws")
	for q, want := range map[string]int{
		"":                      http.StatusBadRequest,
		"?channel=no-colon":     http.StatusBadRequest,
		"?channel=order:*":      http.StatusBadRequest,
		"?channel=admin:secret": http.StatusForbidden,
	} {
		resp, err := http.Get(httpURL + q)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%q: status %d, want %d", q, resp.StatusCode, want)
		}
	}
}

func TestHubDropsSlowClients(t *testing.T) {
	h, _, url := setup(t, Options{SendBuffer: 1, WriteTimeout: 100 * time.Millisecond})
	c := dial(t, url+"?channel=feed:x")
	waitFor(t, func() bool { return h.Subscribers("feed:x") == 1 })
	// Never read: the per-client buffer fills and the hub kicks the client instead of blocking.
	big := strings.Repeat("x", 64<<10)
	for i := 0; i < 200 && h.Subscribers("feed:x") > 0; i++ {
		_ = h.Publish(context.Background(), "feed:x", []byte(big))
		time.Sleep(time.Millisecond)
	}
	waitFor(t, func() bool { return h.Subscribers("feed:x") == 0 })
	_ = c
}

func TestHubShutdownClosesClients(t *testing.T) {
	h, _, url := setup(t, Options{})
	c := dial(t, url+"?channel=feed:y")
	waitFor(t, func() bool { return h.Subscribers("feed:y") == 1 })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	readErr := make(chan error, 1)
	go func() { _, _, err := c.Read(ctx); readErr <- err }() // the client answers the close handshake
	if err := h.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-readErr; websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("close status = %v (%v), want 1001", websocket.CloseStatus(err), err)
	}
}
