package fanout

import (
	"context"
	"fmt"
	"time"

	catalogv1 "github.com/UvinduPathirana/kade/gen/go/kade/catalog/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	ledgerv1 "github.com/UvinduPathirana/kade/gen/go/kade/ledger/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	supportv1 "github.com/UvinduPathirana/kade/gen/go/kade/support/v1"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
)

func (s *Service) registerOther(r *kafka.Router) {
	// Riders going online/offline: ops:live counters.
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.RiderStatusChanged) error {
		online := e.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_ONLINE || e.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB
		return s.v.OpsRiderOnline(ctx, e.GetRiderId(), online)
	})

	// Public restaurant pages.
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *catalogv1.RestaurantAvailabilityChanged) error {
		return s.emit(ctx, d, s.ts(e.GetOccurredAt()), frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
			m.Payload = &realtimev1.RealtimeMessage_RestaurantAvailability{RestaurantAvailability: &realtimev1.RestaurantAvailabilityUpdate{
				RestaurantId: e.GetRestaurantId(), Availability: e.GetAvailability(),
			}}
		}}, channel.Restaurant(e.GetRestaurantId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *catalogv1.MenuItemAvailabilityChanged) error {
		return s.emit(ctx, d, s.ts(e.GetOccurredAt()), frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
			m.Payload = &realtimev1.RealtimeMessage_MenuItemAvailability{MenuItemAvailability: &realtimev1.MenuItemAvailabilityUpdate{
				RestaurantId: e.GetRestaurantId(), ItemId: e.GetItemId(), SoldOut: e.GetSoldOut(),
			}}
		}}, channel.Restaurant(e.GetRestaurantId()))
	})

	// Support chat.
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *supportv1.TicketOpened) error {
		return s.v.SetTicketRequester(ctx, e.GetTicketId(), e.GetTicket().GetRequester().GetId())
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *supportv1.TicketMessageAdded) error {
		if cur, err := s.v.TicketRequester(ctx, e.GetTicketId()); err != nil {
			return err
		} else if cur == "" {
			if err := s.v.SetTicketRequester(ctx, e.GetTicketId(), e.GetRequester().GetId()); err != nil {
				return err
			}
		}
		return s.emit(ctx, d, s.ts(e.GetOccurredAt()), frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
			m.Payload = &realtimev1.RealtimeMessage_SupportMessage{SupportMessage: &realtimev1.SupportMessageUpdate{
				TicketId: e.GetTicketId(), Message: e.GetMessage(),
			}}
		}}, channel.Ticket(e.GetTicketId()))
	})

	// Riders holding too much cash: ops attention item.
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *ledgerv1.RiderCashBalanceChanged) error {
		id := "cash:" + e.GetRiderId()
		b := e.GetBalance()
		if !b.GetOverLimit() {
			return s.v.OpsClearAttention(ctx, id)
		}
		return s.v.OpsAttention(ctx, &dispatchv1.AttentionItem{
			Id:         id,
			Kind:       dispatchv1.AttentionKind_ATTENTION_KIND_RIDER_CASH,
			Title:      "Rider over the cash limit",
			Detail:     fmt.Sprintf("Holding Rs %s (limit Rs %s).", rupees(b.GetHolding().GetAmountMinor()), rupees(b.GetLimit().GetAmountMinor())),
			Severity:   2,
			RecordType: "rider",
			RecordId:   e.GetRiderId(),
		})
	})
}

func rupees(minor int64) string {
	whole := minor / 100
	s := fmt.Sprint(whole)
	if whole < 0 {
		return s
	}
	out := ""
	for len(s) > 3 {
		out = "," + s[len(s)-3:] + out
		s = s[:len(s)-3]
	}
	return s + out
}

// ---------- rider positions (kade.rider.locations, Schema Registry framing) ----------

// positionMaxAge: older fixes are not worth drawing (a replayed or lagging stream).
const positionMaxAge = 30 * time.Second

// HandleLocation routes one GPS fix: to order:<order_id> (the customer's map) and to ops:live (the
// rider dot), each at most once per PositionInterval, across replicas. Out-of-order fixes (by
// sequence) are dropped.
func (s *Service) HandleLocation(ctx context.Context, rec *kgo.Record) error {
	loc := &locationv1.RiderLocation{}
	if _, err := kafka.DecodeConfluent(rec.Value, loc); err != nil {
		return fmt.Errorf("decode rider location: %w", err)
	}
	if loc.GetRiderId() == "" || loc.GetPosition() == nil {
		return nil
	}
	at := loc.GetReceivedAt()
	if at == nil || at.GetSeconds() == 0 {
		at = loc.GetOccurredAt()
	}
	at = s.ts(at)
	if at.AsTime().Before(s.o.Now().Add(-positionMaxAge)) {
		return nil
	}
	if loc.GetSequence() > 0 {
		newer, err := s.v.NewerPosition(ctx, loc.GetRiderId(), loc.GetSequence())
		if err != nil || !newer {
			return err
		}
	}
	id := fmt.Sprintf("%s:%d", loc.GetRiderId(), loc.GetSequence())
	if loc.GetSequence() == 0 {
		id = uuid.NewString()
	}
	msg := func(ch string, set func(m *realtimev1.RealtimeMessage)) error {
		m := &realtimev1.RealtimeMessage{Id: id, SourceType: string(loc.ProtoReflect().Descriptor().FullName()), OccurredAt: at}
		set(m)
		return s.pub.Publish(ctx, ch, m, false)
	}
	if order := loc.GetOrderId(); order != "" {
		ok, err := s.v.Allow(ctx, "pos:order:"+order, s.o.PositionInterval)
		if err != nil {
			return err
		}
		if ok {
			if err := msg(channel.Order(order), func(m *realtimev1.RealtimeMessage) {
				m.Payload = &realtimev1.RealtimeMessage_RiderPosition{RiderPosition: &realtimev1.RiderPositionUpdate{OrderId: order, Location: loc}}
			}); err != nil {
				return err
			}
		}
	}
	ok, err := s.v.Allow(ctx, "pos:rider:"+loc.GetRiderId(), s.o.PositionInterval)
	if err != nil || !ok {
		return err
	}
	return msg(channel.OpsLive, func(m *realtimev1.RealtimeMessage) {
		m.Payload = &realtimev1.RealtimeMessage_OpsLive{OpsLive: &realtimev1.OpsLiveUpdate{Snapshot: &dispatchv1.LiveSnapshot{
			At: at,
			Dots: []*dispatchv1.MapDot{{
				Id: loc.GetRiderId(), Kind: dispatchv1.DotKind_DOT_KIND_RIDER, Location: loc.GetPosition(), Label: activityLabel(loc.GetActivity()),
			}},
		}}}
	})
}

func activityLabel(a locationv1.RiderActivity) string {
	switch a {
	case locationv1.RiderActivity_RIDER_ACTIVITY_IDLE:
		return "Idle"
	case locationv1.RiderActivity_RIDER_ACTIVITY_TO_RESTAURANT:
		return "To restaurant"
	case locationv1.RiderActivity_RIDER_ACTIVITY_AT_RESTAURANT:
		return "At restaurant"
	case locationv1.RiderActivity_RIDER_ACTIVITY_TO_CUSTOMER:
		return "To customer"
	case locationv1.RiderActivity_RIDER_ACTIVITY_AT_CUSTOMER:
		return "At customer"
	}
	return ""
}

// ---------- ops:live counters ----------

// OpsSourceType marks coalesced counter frames on ops:live (rider dots carry the location type).
const OpsSourceType = "kade.dispatch.v1.LiveSnapshot"

// RunOps publishes the ops:live counters at most once per interval, and only when something changed.
// Every replica runs it; GETDEL on the dirty flag makes exactly one of them publish.
func (s *Service) RunOps(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.PublishOps(ctx, false); err != nil && ctx.Err() == nil {
				s.log.WarnContext(ctx, "ops counters publish failed", "err", err)
			}
		}
	}
}

// PublishOps publishes the counters if they changed (or always with force).
func (s *Service) PublishOps(ctx context.Context, force bool) error {
	dirty, err := s.v.TakeOpsDirty(ctx)
	if err != nil {
		return err
	}
	if !dirty && !force {
		return nil
	}
	now := s.o.Now()
	snap, err := s.v.OpsSnapshot(ctx, now)
	if err != nil {
		return err
	}
	return s.pub.Publish(ctx, channel.OpsLive, &realtimev1.RealtimeMessage{
		Id: uuid.NewString(), SourceType: OpsSourceType, OccurredAt: timestamppb.New(now),
		Payload: &realtimev1.RealtimeMessage_OpsLive{OpsLive: &realtimev1.OpsLiveUpdate{Snapshot: snap}},
	}, true)
}
