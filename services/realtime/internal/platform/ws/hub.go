// Package ws is the WebSocket fan-out hub that realtime copies.
//
// Any instance can publish to a Redis channel (e.g. "order:<id>"); every instance that has a
// local client watching that channel receives it and writes it to those sockets. Instances keep
// one Redis subscription connection and subscribe to a channel only while a local client needs
// it, so N instances × M channels never means N×M connections.
//
//	client ──ws──▶ Hub(instance A) ◀── Redis SUBSCRIBE order:42 ◀── PUBLISH order:42 (any service)
//
// Slow clients are disconnected rather than buffered without bound (they reconnect and refetch).
package ws

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/coder/websocket"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/redisx"
)

// ChannelPattern limits what clients may subscribe to: "<kind>:<id>". Authorisation (may this user
// watch order 42?) belongs in the service that owns the WebSocket endpoint; see Options.Authorize.
var ChannelPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9_.-]{1,128}$`)

type Options struct {
	Broker         redisx.Broker
	Logger         *slog.Logger
	SendBuffer     int           // per-client queue; when full the client is dropped (default 64)
	WriteTimeout   time.Duration // default 5s
	PingInterval   time.Duration // default 25s
	OriginPatterns []string      // browser origins allowed (host patterns); empty = same origin only
	// Authorize decides whether r may subscribe to channel. nil allows any well-formed channel.
	Authorize func(r *http.Request, channel string) bool
}

type Hub struct {
	o   Options
	log *slog.Logger

	mu       sync.Mutex
	channels map[string]map[*client]struct{}

	closing   chan struct{} // closed by Shutdown
	closeOnce sync.Once
	active    sync.WaitGroup // running ServeHTTP handlers

	conns metric.Int64UpDownCounter
	sent  metric.Int64Counter
	drops metric.Int64Counter
}

type client struct {
	send      chan []byte
	closeOnce sync.Once
	done      chan struct{}
}

func (c *client) kick() { c.closeOnce.Do(func() { close(c.done) }) }

func NewHub(o Options) (*Hub, error) {
	if o.SendBuffer <= 0 {
		o.SendBuffer = 64
	}
	if o.WriteTimeout <= 0 {
		o.WriteTimeout = 5 * time.Second
	}
	if o.PingInterval <= 0 {
		o.PingInterval = 25 * time.Second
	}
	h := &Hub{o: o, log: o.Logger.With("component", "ws-hub"), channels: map[string]map[*client]struct{}{}, closing: make(chan struct{})}
	m := otel.Meter("kade/ws")
	var err error
	if h.conns, err = m.Int64UpDownCounter("kade.ws.connections"); err != nil {
		return nil, err
	}
	if h.sent, err = m.Int64Counter("kade.ws.messages_sent"); err != nil {
		return nil, err
	}
	if h.drops, err = m.Int64Counter("kade.ws.slow_client_drops"); err != nil {
		return nil, err
	}
	return h, nil
}

// Run forwards broker messages to local clients until ctx is done or the broker closes.
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
			h.fanOut(ctx, m)
		}
	}
}

func (h *Hub) fanOut(ctx context.Context, m redisx.Message) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.channels[m.Channel] {
		select {
		case c.send <- m.Payload:
			h.sent.Add(ctx, 1)
		default:
			h.drops.Add(ctx, 1)
			c.kick() // never block the hub on one slow socket
		}
	}
}

// Publish sends payload to every client of channel on every instance.
func (h *Hub) Publish(ctx context.Context, channel string, payload []byte) error {
	return h.o.Broker.Publish(ctx, channel, payload)
}

// ServeHTTP upgrades GET /ws?channel=note:<id>&channel=... and streams messages as text frames.
// The template is server → client only; realtime adds a read loop if clients send commands.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	select {
	case <-h.closing:
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	default:
	}
	h.active.Add(1)
	defer h.active.Done()
	channels := r.URL.Query()["channel"]
	if len(channels) == 0 || len(channels) > 16 {
		http.Error(w, "1 to 16 channel query parameters required", http.StatusBadRequest)
		return
	}
	for _, ch := range channels {
		if !ChannelPattern.MatchString(ch) {
			http.Error(w, "invalid channel "+ch, http.StatusBadRequest)
			return
		}
		if h.o.Authorize != nil && !h.o.Authorize(r, ch) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: h.o.OriginPatterns})
	if err != nil {
		return // Accept already wrote the error response
	}
	defer conn.CloseNow()
	conn.SetReadLimit(4096)

	c := &client{send: make(chan []byte, h.o.SendBuffer), done: make(chan struct{})}
	if err := h.add(r.Context(), c, channels); err != nil {
		h.log.WarnContext(r.Context(), "subscribe failed", "err", err)
		conn.Close(websocket.StatusTryAgainLater, "subscribe failed")
		return
	}
	defer h.remove(context.WithoutCancel(r.Context()), c, channels)
	h.conns.Add(r.Context(), 1)
	defer h.conns.Add(context.Background(), -1)

	// CloseRead handles pings/close frames from the client and cancels ctx when it goes away.
	ctx := conn.CloseRead(r.Context())
	ping := time.NewTicker(h.o.PingInterval)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			// A client that can't keep up won't answer a close handshake promptly either.
			conn.CloseNow()
			return
		case <-h.closing:
			conn.Close(websocket.StatusGoingAway, "server shutting down") // clients reconnect elsewhere
			return
		case msg := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, h.o.WriteTimeout)
			err := conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, h.o.WriteTimeout)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (h *Hub) add(ctx context.Context, c *client, channels []string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	var fresh []string
	for _, ch := range channels {
		if h.channels[ch] == nil {
			h.channels[ch] = map[*client]struct{}{}
			fresh = append(fresh, ch)
		}
		h.channels[ch][c] = struct{}{}
	}
	if len(fresh) > 0 {
		if err := h.o.Broker.Subscribe(ctx, fresh...); err != nil {
			for _, ch := range channels {
				delete(h.channels[ch], c)
				if len(h.channels[ch]) == 0 {
					delete(h.channels, ch)
				}
			}
			return err
		}
	}
	return nil
}

func (h *Hub) remove(ctx context.Context, c *client, channels []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var empty []string
	for _, ch := range channels {
		delete(h.channels[ch], c)
		if len(h.channels[ch]) == 0 {
			delete(h.channels, ch)
			empty = append(empty, ch)
		}
	}
	if len(empty) > 0 {
		if err := h.o.Broker.Unsubscribe(ctx, empty...); err != nil && !errors.Is(err, context.Canceled) {
			h.log.WarnContext(ctx, "unsubscribe failed", "err", err)
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

// Subscribers returns how many local clients watch channel (tests, debugging).
func (h *Hub) Subscribers(channel string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.channels[channel])
}
