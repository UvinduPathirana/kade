package fanout

import (
	"context"
	"strings"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	merchantv1 "github.com/UvinduPathirana/kade/gen/go/kade/merchant/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
)

func (s *Service) registerOrder(r *kafka.Router) {
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderPlaced) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), true)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderOpen(ctx, o.GetId(), placedAt(o, s.ts(e.GetOccurredAt()).AsTime()), o.GetStatus() != orderv1.OrderStatus_ORDER_STATUS_SCHEDULED, tsTime(o.GetDueAt()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderReleasedToKitchen) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), true)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderOpen(ctx, o.GetId(), placedAt(o, s.ts(e.GetOccurredAt()).AsTime()), true, tsTime(o.GetDueAt()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderAccepted) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), false)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderOpen(ctx, o.GetId(), placedAt(o, s.ts(e.GetOccurredAt()).AsTime()), true, tsTime(o.GetDueAt()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderRejected) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), false)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderFinished(ctx, o.GetId(), s.ts(e.GetOccurredAt()).AsTime(), true, 0)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderCancelled) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), false)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderFinished(ctx, o.GetId(), s.ts(e.GetOccurredAt()).AsTime(), true, 0)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderDelivered) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), false)
		if err != nil || o == nil {
			return err
		}
		at := s.ts(e.GetOccurredAt()).AsTime()
		minutes := 0.0
		if p := placedAt(o, time.Time{}); !p.IsZero() {
			end := at
			if o.GetDeliveredAt().IsValid() && o.GetDeliveredAt().GetSeconds() > 0 {
				end = o.GetDeliveredAt().AsTime()
			}
			minutes = end.Sub(p).Minutes()
		}
		return s.v.OpsOrderFinished(ctx, o.GetId(), at, false, minutes)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderCollected) error {
		o, err := s.orderSnapshot(ctx, d, e.GetOrder(), e.GetOccurredAt(), false)
		if err != nil || o == nil {
			return err
		}
		return s.v.OpsOrderFinished(ctx, o.GetId(), s.ts(e.GetOccurredAt()).AsTime(), false, 0)
	})

	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderPreparing) error {
		at := s.ts(e.GetOccurredAt())
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), e.GetCustomerId(), e.GetRestaurantId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			setStatus(o, orderv1.OrderStatus_ORDER_STATUS_PREPARING)
			setTime(&o.ReadyBy, e.GetReadyBy())
		}); err != nil {
			return err
		}
		return s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_PREPARING)
			setTime(&t.ReadyBy, e.GetReadyBy())
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderReady) error {
		at := s.ts(e.GetOccurredAt())
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), e.GetCustomerId(), e.GetRestaurantId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			setStatus(o, orderv1.OrderStatus_ORDER_STATUS_READY)
			setTime(&o.ReadyAt, at)
		}); err != nil {
			return err
		}
		if err := s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_READY)
			setTime(&t.ReadyAt, at)
		}); err != nil {
			return err
		}
		// "Food is ready" for the assigned rider.
		return s.riderNotice(ctx, d, at, e.GetOrderId(), e.GetDeliveryId(), "Food is ready")
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderRiderChanged) error {
		at := s.ts(e.GetOccurredAt())
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), e.GetCustomerId(), e.GetRestaurantId()}
		if err := s.v.SetOrderRider(ctx, e.GetOrderId(), e.GetRider().GetRiderId()); err != nil {
			return err
		}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			o.Rider = e.GetRider()
			if e.GetDeliveryId() != "" {
				o.DeliveryId = e.GetDeliveryId()
			}
		}); err != nil {
			return err
		}
		return s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) { t.Rider = ticketRider(e.GetRider()) })
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderPickedUp) error {
		at := s.ts(e.GetOccurredAt())
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), e.GetCustomerId(), e.GetRestaurantId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			setStatus(o, orderv1.OrderStatus_ORDER_STATUS_PICKED_UP)
			setTime(&o.PickedUpAt, at)
		}); err != nil {
			return err
		}
		return s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_PICKED_UP)
			setTime(&t.PickedUpAt, at)
			setTime(&t.ClosedAt, at)
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderTipUpdated) error {
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), e.GetCustomerId(), ""}
		_, err := s.patchOrder(ctx, d, s.ts(e.GetOccurredAt()), ref, func(o *orderv1.Order) {
			if o.Totals == nil {
				o.Totals = &orderv1.OrderTotals{}
			}
			o.Totals.Tip = e.GetTip()
			if e.GetTotal() != nil {
				o.Totals.Total = e.GetTotal()
			}
		})
		return err
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderRefunded) error {
		ref := orderRef{e.GetOrderId(), "", "", e.GetRestaurantId()}
		_, err := s.patchOrder(ctx, d, s.ts(e.GetOccurredAt()), ref, func(o *orderv1.Order) { o.Refunded = e.GetRefundedTotal() })
		return err
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.OrderFailed) error {
		at := s.ts(e.GetOccurredAt())
		ref := orderRef{e.GetOrderId(), "", e.GetCustomerId(), e.GetRestaurantId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			setStatus(o, orderv1.OrderStatus_ORDER_STATUS_FAILED)
			o.FailureReason = e.GetFailureReason()
		}); err != nil {
			return err
		}
		return s.v.OpsOrderFinished(ctx, e.GetOrderId(), at.AsTime(), false, 0)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *orderv1.GroupOrderUpdated) error {
		g := e.GetGroup()
		if e.GetGroupId() == "" || g == nil {
			return nil
		}
		members := []string{g.GetHostCustomerId()}
		for _, m := range g.GetMembers() {
			members = append(members, m.GetCustomerId())
		}
		if err := s.v.SetGroupMembers(ctx, e.GetGroupId(), members); err != nil {
			return err
		}
		return s.emit(ctx, d, s.ts(e.GetOccurredAt()), frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
			m.Payload = &realtimev1.RealtimeMessage_GroupOrder{GroupOrder: &realtimev1.GroupOrderUpdate{Group: g}}
		}}, channel.Group(e.GetGroupId()))
	})
}

// ---------- order snapshot ----------

// orderSnapshot stores a full Order from the event and pushes it to order:, customer: and (as a
// kitchen ticket) outlet:. It returns nil when the snapshot was older than what is stored.
func (s *Service) orderSnapshot(ctx context.Context, d *kafka.Delivery, snap *orderv1.Order, at *timestamppb.Timestamp, isNew bool) (*orderv1.Order, error) {
	if snap.GetId() == "" {
		s.log.WarnContext(ctx, "order event without order snapshot", "type", d.EventType, "event_id", d.EventID)
		return nil, nil
	}
	at = s.ts(at)
	o, changed, err := s.v.UpdateOrder(ctx, snap.GetId(), func(cur *orderv1.Order, exists bool) bool {
		return applySnapshot(cur, exists, snap)
	})
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, nil
	}
	if err := s.v.SaveOrderAccess(ctx, o.GetId(), accessOf(o)); err != nil {
		return nil, err
	}
	if err := s.emit(ctx, d, at, orderFrame(o), channel.Order(o.GetId()), channel.Customer(o.GetCustomer().GetId())); err != nil {
		return nil, err
	}
	if ticketStatus(o) == merchantv1.TicketStatus_TICKET_STATUS_UNSPECIFIED {
		return o, nil // PENDING, SCHEDULED, FAILED: not on the kitchen board
	}
	t, _, err := s.v.UpdateTicket(ctx, o.GetId(), func(t *merchantv1.Ticket, _ bool) bool {
		fillTicket(t, o)
		return true
	})
	if err != nil {
		return nil, err
	}
	return o, s.emit(ctx, d, at, ticketFrame(t, isNew && t.GetStatus() == merchantv1.TicketStatus_TICKET_STATUS_NEW), channel.Outlet(t.GetOutletId()))
}

// applySnapshot replaces cur with snap unless snap is behind in the state machine (events of one
// order arrive on different topics, so a late snapshot must not move the status backwards).
func applySnapshot(cur *orderv1.Order, exists bool, snap *orderv1.Order) bool {
	if exists && orderRank(snap.GetStatus()) < orderRank(cur.GetStatus()) {
		return false
	}
	rider, deliveryID := cur.GetRider(), cur.GetDeliveryId()
	proto.Reset(cur)
	proto.Merge(cur, snap)
	if cur.Rider == nil && rider != nil && orderRank(cur.GetStatus()) < rankFinal {
		cur.Rider = rider // dispatch's RiderAssigned can arrive before order's own snapshot shows it
	}
	if cur.DeliveryId == "" {
		cur.DeliveryId = deliveryID
	}
	return true
}

type orderRef struct{ id, number, customerID, restaurantID string }

// patchOrder applies a progress event to the snapshot (creating a skeleton when realtime never saw
// the order) and pushes the result.
func (s *Service) patchOrder(ctx context.Context, d *kafka.Delivery, at *timestamppb.Timestamp, ref orderRef, fn func(o *orderv1.Order)) (*orderv1.Order, error) {
	if ref.id == "" {
		return nil, nil
	}
	o, _, err := s.v.UpdateOrder(ctx, ref.id, func(cur *orderv1.Order, exists bool) bool {
		if !exists {
			cur.Id = ref.id
		}
		if cur.OrderNumber == "" {
			cur.OrderNumber = ref.number
		}
		if cur.Customer == nil && ref.customerID != "" {
			cur.Customer = &commonv1.Contact{Id: ref.customerID}
		}
		if cur.Restaurant == nil && ref.restaurantID != "" {
			cur.Restaurant = &orderv1.OrderRestaurant{Id: ref.restaurantID}
		}
		fn(cur)
		if cur.UpdatedAt == nil || at.AsTime().After(cur.UpdatedAt.AsTime()) {
			cur.UpdatedAt = at
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	if err := s.v.SaveOrderAccess(ctx, ref.id, accessOf(o)); err != nil {
		return nil, err
	}
	return o, s.emit(ctx, d, at, orderFrame(o), channel.Order(ref.id), channel.Customer(o.GetCustomer().GetId()))
}

// patchTicket applies a change to an order's kitchen ticket and pushes it to outlet:<id>.
func (s *Service) patchTicket(ctx context.Context, d *kafka.Delivery, at *timestamppb.Timestamp, ref orderRef, isNew bool, fn func(t *merchantv1.Ticket)) error {
	if ref.id == "" {
		return nil
	}
	t, _, err := s.v.UpdateTicket(ctx, ref.id, func(t *merchantv1.Ticket, exists bool) bool {
		if !exists {
			t.OrderId = ref.id
		}
		if t.OrderNumber == "" && ref.number != "" {
			t.OrderNumber, t.TicketNumber = ref.number, ticketNumber(ref.number)
		}
		if t.OutletId == "" {
			t.OutletId = ref.restaurantID
		}
		fn(t)
		return true
	})
	if err != nil {
		return err
	}
	return s.emit(ctx, d, at, ticketFrame(t, isNew), channel.Outlet(t.GetOutletId()))
}

func ticketFrame(t *merchantv1.Ticket, isNew bool) frame {
	return frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
		m.Payload = &realtimev1.RealtimeMessage_KitchenTicket{KitchenTicket: &realtimev1.KitchenTicketUpdate{Ticket: t, IsNew: isNew}}
	}}
}

// ---------- status helpers ----------

const rankFinal = 9

func orderRank(s orderv1.OrderStatus) int {
	switch s {
	case orderv1.OrderStatus_ORDER_STATUS_PENDING:
		return 1
	case orderv1.OrderStatus_ORDER_STATUS_SCHEDULED:
		return 2
	case orderv1.OrderStatus_ORDER_STATUS_PLACED:
		return 3
	case orderv1.OrderStatus_ORDER_STATUS_ACCEPTED:
		return 4
	case orderv1.OrderStatus_ORDER_STATUS_PREPARING:
		return 5
	case orderv1.OrderStatus_ORDER_STATUS_READY:
		return 6
	case orderv1.OrderStatus_ORDER_STATUS_PICKED_UP:
		return 7
	case orderv1.OrderStatus_ORDER_STATUS_DELIVERED, orderv1.OrderStatus_ORDER_STATUS_COLLECTED,
		orderv1.OrderStatus_ORDER_STATUS_CANCELLED, orderv1.OrderStatus_ORDER_STATUS_REJECTED, orderv1.OrderStatus_ORDER_STATUS_FAILED:
		return rankFinal
	}
	return 0
}

// setStatus moves the status forward only.
func setStatus(o *orderv1.Order, st orderv1.OrderStatus) {
	if orderRank(st) >= orderRank(o.GetStatus()) && orderRank(o.GetStatus()) < rankFinal {
		o.Status = st
	}
}

func ticketRank(s merchantv1.TicketStatus) int {
	switch s {
	case merchantv1.TicketStatus_TICKET_STATUS_NEW:
		return 1
	case merchantv1.TicketStatus_TICKET_STATUS_PREPARING:
		return 2
	case merchantv1.TicketStatus_TICKET_STATUS_READY:
		return 3
	case merchantv1.TicketStatus_TICKET_STATUS_PICKED_UP, merchantv1.TicketStatus_TICKET_STATUS_MISSED,
		merchantv1.TicketStatus_TICKET_STATUS_REJECTED, merchantv1.TicketStatus_TICKET_STATUS_CANCELLED:
		return 4
	}
	return 0
}

func setTicketStatus(t *merchantv1.Ticket, st merchantv1.TicketStatus) {
	if ticketRank(st) >= ticketRank(t.GetStatus()) && ticketRank(t.GetStatus()) < 4 {
		t.Status = st
	}
}

// ticketStatus is the kitchen's view of an order status (proto/README.md, order state machine).
func ticketStatus(o *orderv1.Order) merchantv1.TicketStatus {
	switch o.GetStatus() {
	case orderv1.OrderStatus_ORDER_STATUS_PLACED:
		return merchantv1.TicketStatus_TICKET_STATUS_NEW
	case orderv1.OrderStatus_ORDER_STATUS_ACCEPTED, orderv1.OrderStatus_ORDER_STATUS_PREPARING:
		return merchantv1.TicketStatus_TICKET_STATUS_PREPARING
	case orderv1.OrderStatus_ORDER_STATUS_READY:
		return merchantv1.TicketStatus_TICKET_STATUS_READY
	case orderv1.OrderStatus_ORDER_STATUS_PICKED_UP, orderv1.OrderStatus_ORDER_STATUS_DELIVERED, orderv1.OrderStatus_ORDER_STATUS_COLLECTED:
		return merchantv1.TicketStatus_TICKET_STATUS_PICKED_UP
	case orderv1.OrderStatus_ORDER_STATUS_REJECTED:
		if o.GetRejection().GetReason() == orderv1.RejectionReason_REJECTION_REASON_TIMEOUT {
			return merchantv1.TicketStatus_TICKET_STATUS_MISSED
		}
		return merchantv1.TicketStatus_TICKET_STATUS_REJECTED
	case orderv1.OrderStatus_ORDER_STATUS_CANCELLED:
		return merchantv1.TicketStatus_TICKET_STATUS_CANCELLED
	}
	return merchantv1.TicketStatus_TICKET_STATUS_UNSPECIFIED
}

// fillTicket copies what the kitchen sees from the order. Ticket-only fields (rider_at_counter,
// rider_arrives_at) are left alone.
func fillTicket(t *merchantv1.Ticket, o *orderv1.Order) {
	t.OrderId = o.GetId()
	t.OrderNumber = o.GetOrderNumber()
	t.TicketNumber = ticketNumber(o.GetOrderNumber())
	t.OutletId = o.GetRestaurant().GetId()
	setTicketStatus(t, ticketStatus(o))
	t.Mode = o.GetMode()
	t.CustomerFirstName = firstName(o.GetCustomer().GetName())
	t.RepeatCount = o.GetCustomerRepeatCount()
	t.Lines = t.Lines[:0]
	for _, l := range o.GetLines() {
		t.Lines = append(t.Lines, &merchantv1.TicketLine{
			ItemId: l.GetItemId(), Name: l.GetName(), Quantity: l.GetQuantity(),
			ChoiceNames: l.GetChoiceNames(), Note: l.GetNote(), UnitPrice: l.GetUnitPrice(),
		})
	}
	t.KitchenNote = o.GetKitchenNote()
	t.Cutlery = o.GetCutlery()
	t.Payment = o.GetPayment().GetKind()
	t.Subtotal = o.GetTotals().GetSubtotal()
	t.ScheduledFor = o.GetScheduledFor()
	t.PlacedAt = o.GetPlacedAt()
	t.AcceptBy = o.GetAcceptBy()
	setTime(&t.AcceptedAt, o.GetAcceptedAt())
	if o.GetPrepMinutes() > 0 {
		t.PrepMinutes = o.GetPrepMinutes()
	}
	setTime(&t.ReadyBy, o.GetReadyBy())
	setTime(&t.ReadyAt, o.GetReadyAt())
	setTime(&t.PickedUpAt, o.GetPickedUpAt())
	for _, closed := range []*timestamppb.Timestamp{o.GetPickedUpAt(), o.GetCollectedAt(), o.GetCancellation().GetAt(), o.GetRejection().GetAt()} {
		setTime(&t.ClosedAt, closed)
	}
	if r := o.GetRejection(); r != nil {
		t.RejectReason, t.RejectNote = r.GetReason(), r.GetNote()
	}
	if o.GetRider() != nil {
		t.Rider = ticketRider(o.GetRider())
	}
}

func ticketRider(r *orderv1.OrderRider) *merchantv1.TicketRider {
	if r == nil {
		return nil
	}
	return &merchantv1.TicketRider{RiderId: r.GetRiderId(), Name: r.GetName(), Vehicle: r.GetVehicle(), Plate: r.GetPlate(), MaskedPhone: r.GetMaskedPhone()}
}

// setTime overwrites *dst only with a real timestamp.
func setTime(dst **timestamppb.Timestamp, v *timestamppb.Timestamp) {
	if v != nil && v.IsValid() && v.GetSeconds() > 0 {
		*dst = v
	}
}

// ticketNumber is the digits the kitchen calls out: "KD-2417" → "2417".
func ticketNumber(orderNumber string) string {
	var b strings.Builder
	for _, r := range orderNumber {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func firstName(name string) string {
	if f := strings.Fields(name); len(f) > 0 {
		return f[0]
	}
	return ""
}

func placedAt(o *orderv1.Order, def time.Time) time.Time {
	for _, t := range []*timestamppb.Timestamp{o.GetPlacedAt(), o.GetCreatedAt()} {
		if t.IsValid() && t.GetSeconds() > 0 {
			return t.AsTime()
		}
	}
	return def
}

func accessOf(o *orderv1.Order) channel.OrderAccess {
	return channel.OrderAccess{CustomerID: o.GetCustomer().GetId(), OutletID: o.GetRestaurant().GetId(), RiderID: o.GetRider().GetRiderId()}
}

// tsTime converts a timestamp, mapping unset to the zero time (AsTime would give 1970).
func tsTime(t *timestamppb.Timestamp) time.Time {
	if t == nil || !t.IsValid() || t.GetSeconds() <= 0 {
		return time.Time{}
	}
	return t.AsTime()
}
