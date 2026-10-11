package hub

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"github.com/alicebob/miniredis/v2"
	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/identity"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/redisx"
)

// allow lets user "u1" watch order:1 and order:2; everyone may watch restaurant:*.
func allow(_ context.Context, id identity.Identity, ch string) (bool, error) {
	if strings.HasPrefix(ch, "restaurant:") {
		return true, nil
	}
	return id.UserID == "u1" && (ch == "order:1" || ch == "order:2"), nil
}

func setup(t *testing.T, o Options) (*Hub, string) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	ctx, cancel := context.WithCancel(context.Background())
	b := redisx.NewBroker(ctx, rdb)
	o.Broker, o.Redis, o.Prefix, o.Logger = b, rdb, "rt:", slog.New(slog.NewTextHandler(io.Discard, nil))
	if o.Authorize == nil {
		o.Authorize = allow
	}
	if o.ReplayWindow == 0 {
		o.ReplayWindow = time.Minute
	}
	h, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	go h.Run(ctx)
	srv := httptest.NewServer(h)
	t.Cleanup(func() { srv.Close(); cancel(); b.Close(); rdb.Close() })
	return h, "ws" + strings.TrimPrefix(srv.URL, "http")
}

func dial(t *testing.T, url string, hdr http.Header) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func user(id string) http.Header {
	return http.Header{identity.HeaderUserID: {id}, identity.HeaderRoles: {"customer"}}
}

func send(t *testing.T, c *websocket.Conn, frame string) {
	t.Helper()
	if err := c.Write(context.Background(), websocket.MessageText, []byte(frame)); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, c *websocket.Conn) *realtimev1.ServerFrame {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var f realtimev1.ServerFrame
	if err := protojson.Unmarshal(b, &f); err != nil {
		t.Fatalf("not a ServerFrame: %s (%v)", b, err)
	}
	return &f
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

func orderMsg(status orderv1.OrderStatus) *realtimev1.RealtimeMessage {
	return &realtimev1.RealtimeMessage{Id: "e1", SourceType: "kade.order.v1.OrderAccepted", OccurredAt: timestamppb.Now(),
		Payload: &realtimev1.RealtimeMessage_Order{Order: &realtimev1.OrderUpdate{Order: &orderv1.Order{Id: "1", Status: status}}}}
}

func TestRejectsConnectionsWithoutIdentity(t *testing.T) {
	_, url := setup(t, Options{})
	resp, err := http.Get("http" + strings.TrimPrefix(url, "ws") + "?channel=order:1")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", resp.StatusCode)
	}
	// Query identity is ignored without the dev flag.
	resp, _ = http.Get("http" + strings.TrimPrefix(url, "ws") + "?user=u1")
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("query identity accepted without dev bypass: %d", resp.StatusCode)
	}
}

func TestSubscribeAuthoriseAndReceive(t *testing.T) {
	h, url := setup(t, Options{})
	c := dial(t, url, user("u1"))
	send(t, c, `{"subscribe":{"channels":["order:1","order:3","nonsense"]}}`)
	res := read(t, c).GetSubscribed()
	if strings.Join(res.GetGranted(), ",") != "order:1" || strings.Join(res.GetDenied(), ",") != "order:3,nonsense" {
		t.Fatalf("subscribe result %v", res)
	}
	waitFor(t, func() bool { return h.Subscribers("order:1") == 1 })
	time.Sleep(20 * time.Millisecond) // let Redis confirm the SUBSCRIBE

	if err := h.Publish(context.Background(), "order:1", orderMsg(orderv1.OrderStatus_ORDER_STATUS_ACCEPTED), true); err != nil {
		t.Fatal(err)
	}
	m := read(t, c).GetMessage()
	if m.GetChannel() != "order:1" || m.GetOrder().GetOrder().GetStatus() != orderv1.OrderStatus_ORDER_STATUS_ACCEPTED {
		t.Fatalf("message %v", m)
	}

	// Another user is denied the same channel and never receives it.
	other := dial(t, url, user("u2"))
	send(t, other, `{"subscribe":{"channels":["order:1"]}}`)
	if res := read(t, other).GetSubscribed(); len(res.GetGranted()) != 0 || len(res.GetDenied()) != 1 {
		t.Fatalf("u2 result %v", res)
	}
	if h.Subscribers("order:1") != 1 {
		t.Fatal("denied socket was subscribed")
	}

	// Ping/pong and unsubscribe.
	send(t, c, `{"ping":{"nonce":"n1"}}`)
	if p := read(t, c).GetPong(); p.GetNonce() != "n1" {
		t.Fatalf("pong %v", p)
	}
	send(t, c, `{"unsubscribe":{"channels":["order:1"]}}`)
	waitFor(t, func() bool { return h.Subscribers("order:1") == 0 })
}

func TestInitialChannelsAndReplay(t *testing.T) {
	h, url := setup(t, Options{})
	since := time.Now().Add(-time.Second)
	// Published before anyone listens: only the replay buffer has it.
	_ = h.Publish(context.Background(), "order:2", orderMsg(orderv1.OrderStatus_ORDER_STATUS_READY), true)

	c := dial(t, url+"?channel=order:1", user("u1"))
	if res := read(t, c).GetSubscribed(); strings.Join(res.GetGranted(), ",") != "order:1" {
		t.Fatalf("initial subscribe %v", res)
	}
	sinceJSON, _ := json.Marshal(since.UTC().Format(time.RFC3339Nano))
	send(t, c, `{"subscribe":{"channels":["order:2"],"since":`+string(sinceJSON)+`}}`)
	if res := read(t, c).GetSubscribed(); strings.Join(res.GetGranted(), ",") != "order:2" {
		t.Fatalf("subscribe %v", res)
	}
	if m := read(t, c).GetMessage(); m.GetChannel() != "order:2" || m.GetOrder().GetOrder().GetStatus() != orderv1.OrderStatus_ORDER_STATUS_READY {
		t.Fatalf("replayed %v", m)
	}
}

func TestDevBypassQueryIdentity(t *testing.T) {
	_, url := setup(t, Options{DevBypass: true})
	c := dial(t, url+"?user=u1&roles=customer&channel=order:1", nil)
	if res := read(t, c).GetSubscribed(); len(res.GetGranted()) != 1 {
		t.Fatalf("dev identity not used: %v", res)
	}
	anon := dial(t, url+"?channel=restaurant:5&channel=order:1", nil)
	if res := read(t, anon).GetSubscribed(); strings.Join(res.GetGranted(), ",") != "restaurant:5" {
		t.Fatalf("anonymous dev socket: %v", res)
	}
}

func TestMaxSubscriptions(t *testing.T) {
	_, url := setup(t, Options{MaxSubscriptions: 1})
	c := dial(t, url, user("u1"))
	send(t, c, `{"subscribe":{"channels":["order:1","order:2"]}}`)
	if res := read(t, c).GetSubscribed(); len(res.GetGranted()) != 1 || len(res.GetDenied()) != 1 {
		t.Fatalf("limit not applied: %v", res)
	}
}

func TestBadFrameCloses(t *testing.T) {
	_, url := setup(t, Options{})
	c := dial(t, url, user("u1"))
	send(t, c, `not json`)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, _, err := c.Read(ctx)
	if websocket.CloseStatus(err) != StatusBadFrame {
		t.Fatalf("close status %v (%v)", websocket.CloseStatus(err), err)
	}
}

func TestSlowClientIsKicked(t *testing.T) {
	h, _ := setup(t, Options{SendBuffer: 2})
	c := &client{id: identity.Identity{UserID: "u1"}, send: make(chan []byte, 2), done: make(chan struct{}), subs: map[string]struct{}{}}
	if err := h.add(context.Background(), c, []string{"order:1"}); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		h.fanOut(context.Background(), "order:1", []byte("x"))
	}
	select {
	case <-c.done:
	default:
		t.Fatal("a client whose queue overflowed must be closed, not blocked on")
	}
	if len(c.send) != 2 {
		t.Fatalf("queue = %d", len(c.send))
	}
}

func TestSlowClientCloseCode(t *testing.T) {
	h, url := setup(t, Options{SendBuffer: 1, WriteTimeout: 200 * time.Millisecond})
	c := dial(t, url+"?channel=order:1", user("u1"))
	waitFor(t, func() bool { return h.Subscribers("order:1") == 1 })
	// Never read: the socket's queue fills and the hub closes it instead of blocking.
	big := strings.Repeat("x", 64<<10)
	for i := 0; i < 400 && h.Subscribers("order:1") > 0; i++ {
		h.fanOut(context.Background(), "order:1", []byte(big))
		time.Sleep(time.Millisecond)
	}
	waitFor(t, func() bool { return h.Subscribers("order:1") == 0 })
	_ = c
}

func TestShutdownClosesWithGoingAway(t *testing.T) {
	h, url := setup(t, Options{})
	c := dial(t, url+"?channel=order:1", user("u1"))
	read(t, c) // subscribed
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	readErr := make(chan error, 1)
	go func() { _, _, err := c.Read(ctx); readErr <- err }()
	if err := h.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-readErr; websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("close status = %v (%v), want 1001", websocket.CloseStatus(err), err)
	}
}
