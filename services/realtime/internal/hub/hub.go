// Package hub serves realtime's WebSocket endpoint and fans frames out across replicas.
//
// Fan-out: every replica consumes Kafka in ONE shared consumer group, so each event is handled by
// exactly one replica. That replica publishes the frame to Redis pub/sub channel
// "<prefix><channel>" (e.g. "rt:order:42"). Every replica keeps a single Redis subscription
// connection and subscribes to a channel only while one of its local sockets watches it, so the
// frame reaches the socket wherever it is connected.
//
//	Kafka ─(group "realtime")─▶ replica A ─PUBLISH rt:order:42─▶ Redis ─▶ replica A, B, C ─▶ sockets
//
// Protocol (proto3 JSON of kade.realtime.v1, one frame per text message):
//
//	client → {"subscribe":{"channels":["order:42"],"since":"2026-10-12T08:00:00Z"}}
//	server ← {"subscribed":{"granted":["order:42"],"denied":[]}}
//	client → {"unsubscribe":{"channels":["order:42"]}}
//	client → {"ping":{"nonce":"n1"}}           server ← {"pong":{"nonce":"n1"}}
//	server ← {"message":{"id":…,"channel":"order:42","sourceType":"kade.order.v1.OrderAccepted",…}}
//
// GET /ws?channel=a&channel=b subscribes at connect time (answered with a "subscribed" frame).
//
// Backpressure: each socket has a bounded queue (WS_SEND_BUFFER frames). When it is full the
// socket is CLOSED with 1013 (try again later) rather than silently skipping frames: frames are
// state hints, and a client that missed one would show stale state without knowing it, whereas a
// closed client reconnects, refetches over REST and resubscribes (with `since` for a short replay).
package hub

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
	"github.com/UvinduPathirana/kade/services/realtime/internal/identity"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/redisx"
)

// Close codes.
const (
	StatusSlowConsumer = websocket.StatusTryAgainLater // 1013: queue overflowed, reconnect
	StatusBadFrame     = websocket.StatusUnsupportedData
	replayMax          = 50 // frames kept per channel for Subscribe.since
)

type Options struct {
	Broker    redisx.Broker
	Redis     *redis.Client // publish + replay buffer
	Prefix    string        // Redis pub/sub prefix, "rt:"
	Logger    *slog.Logger
	Authorize func(ctx context.Context, id identity.Identity, ch string) (bool, error)

	DevBypass        bool
	OriginPatterns   []string
	SendBuffer       int           // default 256
	WriteTimeout     time.Duration // default 5s
	PingInterval     time.Duration // default 25s
	MaxSubscriptions int           // default 32
	ReplayWindow     time.Duration // default 2m; 0 disables the buffer
}

type Hub struct {
	o   Options
	log *slog.Logger

	mu       sync.Mutex
	channels map[string]map[*client]struct{}

	closing   chan struct{}
	closeOnce sync.Once
	active    sync.WaitGroup

	conns     metric.Int64UpDownCounter
	sent      metric.Int64Counter
	dropped   metric.Int64Counter
	slow      metric.Int64Counter
	subs      metric.Int64Counter
	published metric.Int64Counter
}

type client struct {
	id        identity.Identity
	send      chan []byte
	done      chan struct{} // closed when the client overflowed
	closeOnce sync.Once
	subs      map[string]struct{} // guarded by Hub.mu
}

func (c *client) kick() { c.closeOnce.Do(func() { close(c.done) }) }

func New(o Options) (*Hub, error) {
	if o.SendBuffer <= 0 {
		o.SendBuffer = 256
	}
	if o.WriteTimeout <= 0 {
		o.WriteTimeout = 5 * time.Second
	}
	if o.PingInterval <= 0 {
		o.PingInterval = 25 * time.Second
	}
	if o.MaxSubscriptions <= 0 {
		o.MaxSubscriptions = 32
	}
	if o.Authorize == nil {
		return nil, errors.New("hub: Authorize is required")
	}
	h := &Hub{o: o, log: o.Logger.With("component", "ws-hub"), channels: map[string]map[*client]struct{}{}, closing: make(chan struct{})}
	m := otel.Meter("kade/realtime")
	var err error
	if h.conns, err = m.Int64UpDownCounter("kade.realtime.ws.connections", metric.WithDescription("Open WebSocket connections")); err != nil {
		return nil, err
	}
	if h.sent, err = m.Int64Counter("kade.realtime.frames.sent", metric.WithDescription("Frames queued to sockets")); err != nil {
		return nil, err
	}
	if h.dropped, err = m.Int64Counter("kade.realtime.frames.dropped", metric.WithDescription("Frames not delivered because the socket's queue was full")); err != nil {
		return nil, err
	}
	if h.slow, err = m.Int64Counter("kade.realtime.ws.slow_closes", metric.WithDescription("Sockets closed for not keeping up")); err != nil {
		return nil, err
	}
	if h.subs, err = m.Int64Counter("kade.realtime.subscriptions", metric.WithDescription("Subscribe requests by result and channel kind")); err != nil {
		return nil, err
	}
	if h.published, err = m.Int64Counter("kade.realtime.frames.published", metric.WithDescription("Frames published to Redis by channel kind")); err != nil {
		return nil, err
	}
	// Export the series from the start so dashboards don't show "no data" before the first socket.
	ctx := context.Background()
	h.conns.Add(ctx, 0)
	h.sent.Add(ctx, 0)
	h.dropped.Add(ctx, 0)
	h.slow.Add(ctx, 0)
	return h, nil
}

// ---------- publishing ----------

// Publish sends msg to every socket watching channel, on every replica. With replay, the frame is
// also kept for ReplayWindow so a client resubscribing with `since` gets what it missed.
func (h *Hub) Publish(ctx context.Context, ch string, msg *realtimev1.RealtimeMessage, replay bool) error {
	msg.Channel = ch
	b, err := protojson.Marshal(&realtimev1.ServerFrame{Frame: &realtimev1.ServerFrame_Message{Message: msg}})
	if err != nil {
		return err
	}
	_, err = h.o.Redis.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Publish(ctx, h.o.Prefix+ch, b)
		if replay && h.o.ReplayWindow > 0 {
			key := h.o.Prefix + "buf:" + ch
			at := time.Now()
			if msg.GetOccurredAt() != nil {
				at = msg.GetOccurredAt().AsTime()
			}
			p.LPush(ctx, key, strconv.FormatInt(at.UnixMilli(), 10)+"|"+string(b))
			p.LTrim(ctx, key, 0, replayMax-1)
			p.PExpire(ctx, key, h.o.ReplayWindow)
		}
		return nil
	})
	if err == nil {
		kind, _, _ := channel.Parse(ch)
		h.published.Add(ctx, 1, metric.WithAttributes(attribute.String("kind", kind)))
	}
	return err
}

// Run forwards broker messages to local sockets until ctx is done or the broker closes.
func (h *Hub) Run(ctx context.Context) error {
	msgs := h.o.Broker.Messages()
	for {
		select {
		case <-ctx.Done():
			return nil
		case m, ok := <-msgs:
			if !ok {
				return nil
			}
			h.fanOut(ctx, strings.TrimPrefix(m.Channel, h.o.Prefix), m.Payload)
		}
	}
}

func (h *Hub) fanOut(ctx context.Context, ch string, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.channels[ch] {
		h.enqueue(ctx, c, payload)
	}
}

// enqueue never blocks: a full queue closes the client (see package doc).
func (h *Hub) enqueue(ctx context.Context, c *client, b []byte) {
	select {
	case <-c.done:
		h.dropped.Add(ctx, 1)
	case c.send <- b:
		h.sent.Add(ctx, 1)
	default:
		h.dropped.Add(ctx, 1)
		h.slow.Add(ctx, 1)
		c.kick()
	}
}

// ---------- sockets ----------

// ServeHTTP upgrades GET /ws. Gateways must set x-user-id (+ x-roles, x-outlet-id, x-rider-id).
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case <-h.closing:
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	default:
	}
	h.active.Add(1)
	defer h.active.Done()

	id := identity.FromRequest(r, h.o.DevBypass)
	if !id.Authenticated() && !h.o.DevBypass {
		http.Error(w, "missing identity headers (x-user-id); connect through a gateway", http.StatusUnauthorized)
		return
	}
	initial := r.URL.Query()["channel"]
	if len(initial) > h.o.MaxSubscriptions {
		http.Error(w, "too many channels", http.StatusBadRequest)
		return
	}
	// Gateways may forward the browser's Origin on the proxied upgrade. Identity comes only from
	// headers a browser cannot set (no cookies), so cross-site sockets gain nothing and the Origin
	// check is off unless WS_ORIGIN_PATTERNS lists allowed origins.
	accept := &websocket.AcceptOptions{OriginPatterns: h.o.OriginPatterns, InsecureSkipVerify: len(h.o.OriginPatterns) == 0}
	conn, err := websocket.Accept(w, r, accept)
	if err != nil {
		return // Accept already wrote the error response
	}
	defer conn.CloseNow()
	conn.SetReadLimit(16 << 10)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	c := &client{id: id, send: make(chan []byte, h.o.SendBuffer), done: make(chan struct{}), subs: map[string]struct{}{}}
	h.conns.Add(ctx, 1)
	defer h.conns.Add(context.Background(), -1)
	defer h.removeAll(context.WithoutCancel(ctx), c)
	h.log.DebugContext(ctx, "socket open", "user", id.UserID, "roles", id.Roles, "dev", id.Dev)

	if len(initial) > 0 {
		h.subscribe(ctx, c, initial, nil)
	}

	readErr := make(chan error, 1)
	go func() { readErr <- h.readLoop(ctx, conn, c); cancel() }()

	ping := time.NewTicker(h.o.PingInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			select {
			case err := <-readErr:
				if errors.Is(err, errBadFrame) {
					conn.Close(StatusBadFrame, "bad frame")
				}
			default:
			}
			return
		case <-c.done:
			// A client that can't keep up won't answer a close handshake promptly either.
			h.log.InfoContext(ctx, "closing slow client", "user", id.UserID)
			conn.Close(StatusSlowConsumer, "slow consumer")
			return
		case <-h.closing:
			conn.Close(websocket.StatusGoingAway, "server shutting down") // clients reconnect elsewhere
			return
		case msg := <-c.send:
			wctx, wcancel := context.WithTimeout(ctx, h.o.WriteTimeout)
			err := conn.Write(wctx, websocket.MessageText, msg)
			wcancel()
			if err != nil {
				return
			}
		case <-ping.C:
			// Heartbeat: a peer that doesn't pong within WriteTimeout is gone.
			pctx, pcancel := context.WithTimeout(ctx, h.o.WriteTimeout)
			err := conn.Ping(pctx)
			pcancel()
			if err != nil {
				return
			}
		}
	}
}

var errBadFrame = errors.New("bad frame")

func (h *Hub) readLoop(ctx context.Context, conn *websocket.Conn, c *client) error {
	unmarshal := protojson.UnmarshalOptions{DiscardUnknown: true}
	for {
		typ, b, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		if typ != websocket.MessageText {
			return errBadFrame
		}
		var f realtimev1.ClientFrame
		if err := unmarshal.Unmarshal(b, &f); err != nil {
			return errBadFrame
		}
		switch fr := f.Frame.(type) {
		case *realtimev1.ClientFrame_Subscribe:
			h.subscribe(ctx, c, fr.Subscribe.GetChannels(), fr.Subscribe.GetSince())
		case *realtimev1.ClientFrame_Unsubscribe:
			h.unsubscribe(ctx, c, fr.Unsubscribe.GetChannels())
		case *realtimev1.ClientFrame_Ping:
			h.reply(ctx, c, &realtimev1.ServerFrame{Frame: &realtimev1.ServerFrame_Pong{Pong: &realtimev1.Pong{Nonce: fr.Ping.GetNonce()}}})
		default:
			return errBadFrame
		}
	}
}

func (h *Hub) reply(ctx context.Context, c *client, f *realtimev1.ServerFrame) {
	b, err := protojson.Marshal(f)
	if err != nil {
		h.log.ErrorContext(ctx, "encode frame", "err", err)
		return
	}
	h.enqueue(ctx, c, b)
}

func (h *Hub) subscribe(ctx context.Context, c *client, chans []string, since *timestamppb.Timestamp) {
	res := &realtimev1.SubscribeResult{Granted: []string{}, Denied: []string{}}
	var granted []string
	for _, ch := range chans {
		if h.isSubscribed(c, ch) {
			res.Granted = append(res.Granted, ch)
			continue
		}
		ok := false
		if h.count(c)+len(granted) < h.o.MaxSubscriptions {
			actx, cancel := context.WithTimeout(ctx, 3*time.Second)
			var err error
			ok, err = h.o.Authorize(actx, c.id, ch)
			cancel()
			if err != nil {
				h.log.WarnContext(ctx, "authorisation failed", "channel", ch, "user", c.id.UserID, "err", err)
			}
		}
		kind, _, _ := channel.Parse(ch)
		result := "denied"
		if ok {
			result = "granted"
			granted = append(granted, ch)
			res.Granted = append(res.Granted, ch)
		} else {
			res.Denied = append(res.Denied, ch)
		}
		h.subs.Add(ctx, 1, metric.WithAttributes(attribute.String("result", result), attribute.String("kind", kind)))
	}
	if len(granted) > 0 {
		if err := h.add(ctx, c, granted); err != nil {
			h.log.WarnContext(ctx, "redis subscribe failed", "err", err)
			failed := map[string]bool{}
			for _, ch := range granted {
				failed[ch] = true
			}
			kept := res.Granted[:0]
			for _, ch := range res.Granted {
				if !failed[ch] {
					kept = append(kept, ch)
				}
			}
			res.Granted, res.Denied = kept, append(res.Denied, granted...)
			granted = nil
		}
	}
	h.reply(ctx, c, &realtimev1.ServerFrame{Frame: &realtimev1.ServerFrame_Subscribed{Subscribed: res}})
	if since != nil && len(granted) > 0 && h.o.ReplayWindow > 0 {
		h.replay(ctx, c, granted, since.AsTime())
	}
}

// replay sends buffered frames newer than since, oldest first.
func (h *Hub) replay(ctx context.Context, c *client, chans []string, since time.Time) {
	for _, ch := range chans {
		items, err := h.o.Redis.LRange(ctx, h.o.Prefix+"buf:"+ch, 0, replayMax-1).Result()
		if err != nil {
			h.log.WarnContext(ctx, "replay read failed", "channel", ch, "err", err)
			continue
		}
		for i := len(items) - 1; i >= 0; i-- {
			ts, frame, ok := strings.Cut(items[i], "|")
			ms, err := strconv.ParseInt(ts, 10, 64)
			if !ok || err != nil || !time.UnixMilli(ms).After(since) {
				continue
			}
			h.enqueue(ctx, c, []byte(frame))
		}
	}
}

func (h *Hub) isSubscribed(c *client, ch string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := c.subs[ch]
	return ok
}

func (h *Hub) count(c *client) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(c.subs)
}

func (h *Hub) add(ctx context.Context, c *client, chans []string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	var fresh []string
	for _, ch := range chans {
		if h.channels[ch] == nil {
			h.channels[ch] = map[*client]struct{}{}
			fresh = append(fresh, h.o.Prefix+ch)
		}
		h.channels[ch][c] = struct{}{}
		c.subs[ch] = struct{}{}
	}
	if len(fresh) > 0 {
		if err := h.o.Broker.Subscribe(ctx, fresh...); err != nil {
			h.dropLocked(ctx, c, chans, false)
			return err
		}
	}
	return nil
}

func (h *Hub) unsubscribe(ctx context.Context, c *client, chans []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dropLocked(ctx, c, chans, true)
}

func (h *Hub) removeAll(ctx context.Context, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	chans := make([]string, 0, len(c.subs))
	for ch := range c.subs {
		chans = append(chans, ch)
	}
	h.dropLocked(ctx, c, chans, true)
}

func (h *Hub) dropLocked(ctx context.Context, c *client, chans []string, unsubscribe bool) {
	var empty []string
	for _, ch := range chans {
		delete(c.subs, ch)
		if set := h.channels[ch]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.channels, ch)
				empty = append(empty, h.o.Prefix+ch)
			}
		}
	}
	if unsubscribe && len(empty) > 0 {
		if err := h.o.Broker.Unsubscribe(ctx, empty...); err != nil && !errors.Is(err, context.Canceled) {
			h.log.WarnContext(ctx, "redis unsubscribe failed", "err", err)
		}
	}
}

// Shutdown closes every socket with 1001 (going away) and waits for handlers to exit.
// http.Server.Shutdown does not track hijacked WebSocket connections, so call this as well.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.closeOnce.Do(func() { close(h.closing) })
	done := make(chan struct{})
	go func() { h.active.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Subscribers returns how many local sockets watch channel (tests, debugging).
func (h *Hub) Subscribers(ch string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.channels[ch])
}
