package dispatch

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	ledgerv1 "github.com/UvinduPathirana/kade/gen/go/kade/ledger/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	reviewv1 "github.com/UvinduPathirana/kade/gen/go/kade/review/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/kafka"
)

// Events in:
//
//	kade.order.events   OrderAccepted (start matching), OrderReady (food ready), OrderTipUpdated,
//	                    OrderCancelled (cancel the delivery, compensate the rider)
//	kade.ledger.events  RiderCashBalanceChanged (cash held, limit → cash orders allowed or not)
//	kade.review.events  RiderRatingChanged (rider rating), OrderRated (stars on the trip)
//	kade.rider.locations (registry stream, not via this router) → ConsumeLocations

// RegisterHandlers wires the idempotent consumers.
func (c *Core) RegisterHandlers(r *kafka.Router) {
	kafka.Handle(r, c.onOrderAccepted)
	kafka.Handle(r, c.onOrderReady)
	kafka.Handle(r, c.onOrderTipUpdated)
	kafka.Handle(r, c.onOrderCancelled)
	kafka.Handle(r, c.onCashBalanceChanged)
	kafka.Handle(r, c.onRiderRatingChanged)
	kafka.Handle(r, c.onOrderRated)
}

// BuildDelivery turns an accepted order into a delivery waiting for a rider. Returns nil for
// pickup orders.
func BuildDelivery(e *orderv1.OrderAccepted, id string, now time.Time) *DeliveryRow {
	o := e.GetOrder()
	if o.GetMode() == commonv1.FulfilmentMode_FULFILMENT_MODE_PICKUP {
		return nil
	}
	rest, addr := o.GetRestaurant(), o.GetAddress()
	tripKm := round1(o.GetDistanceKm())
	if tripKm <= 0 {
		tripKm = RoadKm(rest.GetLocation(), addr.GetLocation())
	}
	// The address note and the order's rider note are often the same text (the checkout copies the
	// saved address note into the rider note): show it once.
	var notes []string
	for _, n := range []string{addr.GetNote(), o.GetRiderNote()} {
		if n = strings.TrimSpace(n); n != "" && !slices.ContainsFunc(notes, func(m string) bool { return strings.EqualFold(m, n) }) {
			notes = append(notes, n)
		}
	}
	items := make([]*dispatchv1.DeliveryItem, 0, len(o.GetLines()))
	for i, l := range o.GetLines() {
		itemID := l.GetKey()
		if itemID == "" {
			itemID = strconv.Itoa(i + 1)
		}
		opts := append([]string(nil), l.GetChoiceNames()...)
		if n := strings.TrimSpace(l.GetNote()); n != "" {
			opts = append(opts, n)
		}
		items = append(items, &dispatchv1.DeliveryItem{Id: itemID, Quantity: l.GetQuantity(), Name: l.GetName(), Options: strings.Join(opts, ", ")})
	}
	payment := o.GetPayment().GetKind()
	var cash, paysWith int64
	if payment == commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH {
		cash = o.GetTotals().GetTotal().GetAmountMinor()
		paysWith = o.GetPayment().GetCashPayingWith().GetAmountMinor()
	}
	readyBy := e.GetReadyBy()
	if readyBy == nil {
		readyBy = o.GetReadyBy()
	}
	zone := o.GetZoneId()
	if zone == "" {
		zone = addr.GetZoneId()
	}
	if zone == "" {
		zone = ZoneOf(rest.GetLocation())
	}
	d := &dispatchv1.Delivery{
		Id: id, OrderId: o.GetId(), OrderNumber: o.GetOrderNumber(), ZoneId: zone,
		Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING,
		Pickup: &dispatchv1.PickupStop{
			RestaurantId: rest.GetId(), Name: rest.GetName(), Area: rest.GetArea(), Address: rest.GetAddress(),
			Phone: rest.GetPhone(), Location: rest.GetLocation(),
		},
		Dropoff: &dispatchv1.DropoffStop{
			FirstName: firstName(o.GetCustomer().GetName()), Area: addr.GetArea(), Address: addr.GetLine(),
			Note: strings.Join(notes, " · "), MaskedPhone: maskedPhone("3", o.GetId()), Location: addr.GetLocation(),
		},
		TripKm:           tripKm,
		Minutes:          TravelMinutes(tripKm) + HandoverMinutes,
		Pay:              ComputePay(tripKm, o.GetTotals().GetTip().GetAmountMinor(), now),
		Payment:          payment,
		CashToCollect:    lkr(cash),
		CustomerPaysWith: lkr(paysWith),
		Items:            items,
		ReadyBy:          readyBy,
		RequestedAt:      ts(now),
	}
	return &DeliveryRow{
		D: d, CustomerID: o.GetCustomer().GetId(), Code: o.GetDeliveryCode(), DueAt: timeOf(o.GetDueAt()), NextAttemptAt: &now,
	}
}

func (c *Core) onOrderAccepted(ctx context.Context, tx pgx.Tx, d *kafka.Delivery, e *orderv1.OrderAccepted) error {
	if e.GetOrder().GetId() == "" {
		return kafka.Permanent(errors.New("OrderAccepted without an order snapshot"))
	}
	now := c.Now()
	if at := e.GetOccurredAt(); at != nil && now.Sub(at.AsTime()) > c.Opt.MaxEventAge {
		c.Log.InfoContext(ctx, "old OrderAccepted ignored (history replay)", "order_id", e.GetOrderId(), "occurred_at", at.AsTime())
		return nil
	}
	id, _ := uuid.NewV7()
	row := BuildDelivery(e, id.String(), now)
	if row == nil {
		return nil // pickup order: no rider needed
	}
	inserted, err := saveDelivery(ctx, tx, row, true)
	if err != nil || !inserted {
		return err // !inserted: the order already has a delivery
	}
	if err := emitDelivery(ctx, tx, row.D.GetId(), &dispatchv1.DeliveryRequested{
		DeliveryId: row.D.GetId(), OrderId: row.D.GetOrderId(), Delivery: row.D, OccurredAt: ts(now),
	}); err != nil {
		return err
	}
	c.Log.InfoContext(ctx, "delivery requested", "delivery_id", row.D.GetId(), "order_number", row.D.GetOrderNumber())
	d.AfterCommit(func(context.Context) { c.Wake() })
	return nil
}

func (c *Core) onOrderReady(ctx context.Context, tx pgx.Tx, _ *kafka.Delivery, e *orderv1.OrderReady) error {
	at := c.Now()
	if e.GetOccurredAt() != nil {
		at = e.GetOccurredAt().AsTime()
	}
	_, err := tx.Exec(ctx, `UPDATE deliveries SET food_ready_at = COALESCE(food_ready_at, $2), updated_at = now() WHERE order_id = $1`, e.GetOrderId(), at)
	return err
}

func (c *Core) onOrderTipUpdated(ctx context.Context, tx pgx.Tx, _ *kafka.Delivery, e *orderv1.OrderTipUpdated) error {
	d, err := loadDelivery(ctx, tx, "order_id", e.GetOrderId(), true)
	if err != nil {
		if hasReason(err, "DELIVERY_NOT_FOUND") {
			return nil
		}
		return err
	}
	d.D.Pay = WithTip(d.D.GetPay(), e.GetTip().GetAmountMinor())
	_, err = saveDelivery(ctx, tx, d, false)
	return err
}

func (c *Core) onOrderCancelled(ctx context.Context, tx pgx.Tx, kd *kafka.Delivery, e *orderv1.OrderCancelled) error {
	d, err := loadDelivery(ctx, tx, "order_id", e.GetOrderId(), true)
	if err != nil {
		if hasReason(err, "DELIVERY_NOT_FOUND") {
			return nil
		}
		return err
	}
	switch d.D.GetStatus() {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED, dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED:
		return nil
	}
	now := c.Now()
	if _, err := withdrawOpenOffers(ctx, tx, d.D.GetId(), now); err != nil {
		return err
	}
	riderID := d.D.GetRiderId()
	comp := Compensation(d.D)
	reason := e.GetCancellation().GetReason()
	if reason == "" {
		reason = "Order cancelled"
	}
	d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED
	d.NextAttemptAt = nil
	if _, err := saveDelivery(ctx, tx, d, false); err != nil {
		return err
	}
	if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.DeliveryCancelled{
		DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), RiderId: riderID, Reason: reason, Compensation: comp, OccurredAt: ts(now),
	}); err != nil {
		return err
	}
	if riderID != "" {
		if err := c.freeRider(ctx, tx, riderID, now); err != nil {
			return err
		}
		kd.AfterCommit(func(ctx context.Context) { c.restoreAvailability(ctx, riderID) })
	}
	return nil
}

// freeRider puts a rider who was on a job back ONLINE (unless they went offline or were suspended).
func (c *Core) freeRider(ctx context.Context, tx pgx.Tx, riderID string, now time.Time) error {
	r, err := loadRider(ctx, tx, riderID, true)
	if err != nil {
		return err
	}
	if r.R.GetStatus() != dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB {
		return nil
	}
	return c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_ONLINE, "", now)
}

// restoreAvailability re-adds an ONLINE rider to the GEO index at their last known position.
func (c *Core) restoreAvailability(ctx context.Context, riderID string) {
	r, err := loadRider(ctx, c.Pool, riderID, false)
	if err != nil || r.R.GetStatus() != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE {
		return
	}
	if p := c.lastPosition(ctx, r); p != nil {
		if err := c.Fleet.MakeAvailable(ctx, riderID, p, c.Now()); err != nil {
			c.Log.WarnContext(ctx, "re-adding rider to the GEO index failed", "rider_id", riderID, "err", err)
		}
	}
}

func (c *Core) onCashBalanceChanged(ctx context.Context, tx pgx.Tx, _ *kafka.Delivery, e *ledgerv1.RiderCashBalanceChanged) error {
	r, err := loadRider(ctx, tx, e.GetRiderId(), true)
	if err != nil {
		if hasReason(err, "RIDER_NOT_FOUND") {
			return nil // not one of ours (or not yet approved)
		}
		return err
	}
	b := e.GetBalance()
	r.R.CashHeld = lkr(b.GetHolding().GetAmountMinor())
	if b.GetLimit().GetAmountMinor() > 0 {
		r.R.CashLimit = lkr(b.GetLimit().GetAmountMinor())
	}
	r.R.CashAllowed = !b.GetOverLimit()
	return saveRider(ctx, tx, r, false)
}

func (c *Core) onRiderRatingChanged(ctx context.Context, tx pgx.Tx, _ *kafka.Delivery, e *reviewv1.RiderRatingChanged) error {
	r, err := loadRider(ctx, tx, e.GetRiderId(), true)
	if err != nil {
		if hasReason(err, "RIDER_NOT_FOUND") {
			return nil
		}
		return err
	}
	r.R.Rating = round1(e.GetSummary().GetAverage())
	r.R.RatingCount = e.GetSummary().GetCount()
	return saveRider(ctx, tx, r, false)
}

func (c *Core) onOrderRated(ctx context.Context, tx pgx.Tx, _ *kafka.Delivery, e *reviewv1.OrderRated) error {
	stars := e.GetRating().GetRiderStars()
	if stars <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE deliveries SET customer_rating = $2, updated_at = now() WHERE order_id = $1`, e.GetOrderId(), int16(stars))
	return err
}

// ---------- kade.rider.locations ----------

// ConsumeLocations reads the GPS stream (Confluent-framed RiderLocation, key = rider id) and moves
// available riders in the GEO index. Positions are not business events: no processed_events,
// starts at the latest offset, and a lost ping is fine. Last positions are also written to
// Postgres at most once a minute per rider (fallback when Redis is empty).
func (c *Core) ConsumeLocations(ctx context.Context, cl *kgo.Client) {
	defer cl.Close()
	var mu sync.Mutex
	persisted := map[string]time.Time{}
	for {
		fetches := cl.PollRecords(ctx, 1000)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			return
		}
		fetches.EachError(func(topic string, p int32, err error) {
			if !errors.Is(err, context.Canceled) {
				c.Log.WarnContext(ctx, "location fetch error", "topic", topic, "partition", p, "err", err)
			}
		})
		var locs []*locationv1.RiderLocation
		fetches.EachRecord(func(r *kgo.Record) {
			var l locationv1.RiderLocation
			if _, err := kafka.DecodeConfluent(r.Value, &l); err != nil || l.GetRiderId() == "" {
				return
			}
			locs = append(locs, &l)
		})
		if len(locs) == 0 {
			continue
		}
		if err := c.Fleet.Move(ctx, locs); err != nil && ctx.Err() == nil {
			c.Log.WarnContext(ctx, "updating the GEO index failed", "err", err)
		}
		now := c.Now()
		mu.Lock()
		var due []*locationv1.RiderLocation
		for _, l := range locs {
			if _, err := uuid.Parse(l.GetRiderId()); err != nil {
				continue
			}
			if now.Sub(persisted[l.GetRiderId()]) >= time.Minute {
				persisted[l.GetRiderId()] = now
				due = append(due, l)
			}
		}
		mu.Unlock()
		if err := c.persistPositions(ctx, due); err != nil && ctx.Err() == nil {
			c.Log.WarnContext(ctx, "saving last positions failed", "err", err)
		}
	}
}

func (c *Core) persistPositions(ctx context.Context, locs []*locationv1.RiderLocation) error {
	if len(locs) == 0 {
		return nil
	}
	ids, lats, lngs, seen := make([]string, len(locs)), make([]float64, len(locs)), make([]float64, len(locs)), make([]time.Time, len(locs))
	for i, l := range locs {
		ids[i], lats[i], lngs[i] = l.GetRiderId(), l.GetPosition().GetLat(), l.GetPosition().GetLng()
		seen[i] = c.Now()
		if l.GetReceivedAt() != nil {
			seen[i] = l.GetReceivedAt().AsTime()
		}
	}
	_, err := c.Pool.Exec(ctx, `UPDATE riders r SET last_lat = u.lat, last_lng = u.lng, last_seen_at = u.seen
	  FROM unnest($1::text[], $2::float8[], $3::float8[], $4::timestamptz[]) AS u(id, lat, lng, seen)
	  WHERE r.id::text = u.id AND (r.last_seen_at IS NULL OR r.last_seen_at < u.seen)`, ids, lats, lngs, seen)
	return err
}
