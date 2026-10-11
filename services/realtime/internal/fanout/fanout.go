// Package fanout maps Kafka events to realtime frames: it updates the Redis views, then publishes
// one RealtimeMessage per affected channel. The channel/frame table lives in README.md.
package fanout

import (
	"context"
	"log/slog"
	"time"

	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/realtime/internal/views"
)

// Publisher delivers a message to every socket on channel (the hub, through Redis pub/sub).
type Publisher interface {
	Publish(ctx context.Context, channel string, msg *realtimev1.RealtimeMessage, replay bool) error
}

type Options struct {
	Views     *views.Store
	Publisher Publisher
	Logger    *slog.Logger
	Now       func() time.Time // default time.Now

	// Events older than this still update the views but are not pushed (a new consumer group
	// replays the topics from the start to rebuild the views; nobody wants last week's pushes).
	StaleAfter time.Duration
	// At most one rider position frame per order (order:<id>) and per rider (ops:live) per interval.
	PositionInterval time.Duration
	// Open offers are remembered this long (dispatch expires them after 30 s).
	OfferTTL time.Duration
}

type Service struct {
	v   *views.Store
	pub Publisher
	log *slog.Logger
	o   Options
}

func New(o Options) *Service {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.StaleAfter <= 0 {
		o.StaleAfter = 10 * time.Minute
	}
	if o.PositionInterval <= 0 {
		o.PositionInterval = time.Second
	}
	if o.OfferTTL <= 0 {
		o.OfferTTL = 2 * time.Minute
	}
	return &Service{v: o.Views, pub: o.Publisher, log: o.Logger.With("component", "fanout"), o: o}
}

// Register maps every consumed event type to its handler.
func (s *Service) Register(r *kafka.Router) {
	s.registerOrder(r)
	s.registerMerchant(r)
	s.registerDelivery(r)
	s.registerOther(r)
}

// frame is one push: payload set on a RealtimeMessage, sent to channels.
type frame struct {
	set    func(m *realtimev1.RealtimeMessage)
	replay bool
}

// emit publishes f on every channel (skipping empty names) unless the event is stale.
func (s *Service) emit(ctx context.Context, d *kafka.Delivery, at *timestamppb.Timestamp, f frame, channels ...string) error {
	if s.stale(at) {
		return nil
	}
	seen := map[string]bool{}
	for _, ch := range channels {
		if ch == "" || seen[ch] || hasEmptyID(ch) {
			continue
		}
		seen[ch] = true
		m := &realtimev1.RealtimeMessage{Id: d.EventID.String(), SourceType: d.EventType, OccurredAt: at}
		f.set(m)
		if err := s.pub.Publish(ctx, ch, m, f.replay); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) stale(at *timestamppb.Timestamp) bool {
	return at != nil && at.IsValid() && at.AsTime().Before(s.o.Now().Add(-s.o.StaleAfter))
}

func hasEmptyID(ch string) bool { return ch[len(ch)-1] == ':' }

// ts returns at, or now when the event carried no time.
func (s *Service) ts(at *timestamppb.Timestamp) *timestamppb.Timestamp {
	if at == nil || !at.IsValid() || at.AsTime().IsZero() || at.GetSeconds() == 0 {
		return timestamppb.New(s.o.Now())
	}
	return at
}

// ---------- payload builders ----------

func orderFrame(o *orderv1.Order) frame {
	safe := Sanitize(o)
	return frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
		m.Payload = &realtimev1.RealtimeMessage_Order{Order: &realtimev1.OrderUpdate{Order: safe}}
	}}
}

// Sanitize strips ops-only fields from an order before it leaves realtime: order:<id> is watched by
// the customer, the outlet and the rider (gateways only proxy the socket, they don't rewrite frames).
func Sanitize(o *orderv1.Order) *orderv1.Order {
	c := proto.Clone(o).(*orderv1.Order)
	c.Notes = nil
	if c.Customer != nil {
		c.Customer.Phone = ""
	}
	if c.Rider != nil {
		c.Rider.Phone = ""
	}
	if c.Restaurant != nil {
		c.Restaurant.Phone = ""
	}
	return c
}
