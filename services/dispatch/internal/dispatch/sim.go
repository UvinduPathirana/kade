package dispatch

import (
	"context"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Simulator drives the demo fleet (riders without a login, `simulated` = true) so orders get
// delivered and the customer's tracking map moves even when nobody is holding the rider app.
// It uses the same code paths as the rider app (AcceptOffer, ArriveAtRestaurant, …), so every
// event is real. Real riders such as Nimal are never touched.
//
//	offer → accept after SIM_ACCEPT_DELAY → ride to the restaurant (SIM_SECONDS_PER_KM per km,
//	15 s–3 min) → wait for the food (OrderReady, the kitchen's ready_by, at most 20 min) →
//	pickup (sealed) → ride to the customer → door → complete with the order's delivery code and
//	the exact cash.
type Simulator struct {
	c           *Core
	api         *DispatchAPI
	perKm       time.Duration
	acceptDelay time.Duration
}

func NewSimulator(c *Core, perKm, acceptDelay time.Duration) *Simulator {
	return &Simulator{c: c, api: NewDispatchAPI(c), perKm: perKm, acceptDelay: acceptDelay}
}

// Run ticks every 2 s until ctx ends.
func (s *Simulator) Run(ctx context.Context) {
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Tick(ctx)
		}
	}
}

// Leg is how long a simulated ride of km takes.
func (s *Simulator) Leg(km float64) time.Duration {
	return min(max(time.Duration(km*float64(s.perKm)), 15*time.Second), 3*time.Minute)
}

func (s *Simulator) Tick(ctx context.Context) {
	c := s.c
	now := c.Now()
	// 1. Accept offers made to simulated riders.
	rows, err := c.Pool.Query(ctx, `SELECT o.id::text, o.rider_id::text FROM offers o JOIN riders r ON r.id = o.rider_id
	  WHERE o.status = $1 AND r.simulated AND o.offered_at <= $2 AND o.expires_at > $3`,
		int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED), now.Add(-s.acceptDelay), now)
	if err != nil {
		if ctx.Err() == nil {
			c.Log.WarnContext(ctx, "sim: listing offers failed", "err", err)
		}
		return
	}
	type pair struct{ offer, rider string }
	offers, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (pair, error) {
		var p pair
		return p, r.Scan(&p.offer, &p.rider)
	})
	if err != nil {
		return
	}
	for _, p := range offers {
		if _, err := s.api.AcceptOffer(ctx, &dispatchv1.AcceptOfferRequest{RiderId: p.rider, OfferId: p.offer, IdempotencyKey: "sim-" + p.offer}); err != nil {
			c.Log.InfoContext(ctx, "sim: accept failed", "offer_id", p.offer, "err", err)
		}
	}

	// 2. Move every simulated job one step along.
	active, err := listDeliveries(ctx, c.Pool, `WHERE status = ANY($1) AND rider_id IN (SELECT id FROM riders WHERE simulated)`, activeStatuses)
	if err != nil {
		return
	}
	var locs []*locationv1.RiderLocation
	for _, d := range active {
		s.advance(ctx, d, now)
		if loc := s.position(d, now); loc != nil {
			locs = append(locs, loc)
		}
	}
	if len(locs) > 0 && c.Reporter != nil {
		if err := c.Reporter(ctx, locs); err != nil && ctx.Err() == nil {
			c.Log.DebugContext(ctx, "sim: reporting positions failed", "err", err)
		}
	}
}

func (s *Simulator) advance(ctx context.Context, d *DeliveryRow, now time.Time) {
	rid, id := d.D.GetRiderId(), d.D.GetId()
	key := func(step string) string { return "sim-" + step + "-" + id + "-" + rid }
	var err error
	switch d.D.GetStatus() {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED:
		if now.After(d.D.GetAssignedAt().AsTime().Add(s.Leg(d.D.GetToPickupKm()))) {
			_, err = s.api.ArriveAtRestaurant(ctx, &dispatchv1.ArriveAtRestaurantRequest{RiderId: rid, DeliveryId: id, IdempotencyKey: key("arrive")})
		}
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
		arrived := d.D.GetArrivedAtRestaurantAt().AsTime()
		ready := d.FoodReadyAt != nil || d.D.GetReadyBy() == nil || now.After(d.D.GetReadyBy().AsTime())
		if (ready && now.After(arrived.Add(15*time.Second))) || now.After(arrived.Add(20*time.Minute)) {
			_, err = s.api.ConfirmPickup(ctx, &dispatchv1.ConfirmPickupRequest{RiderId: rid, DeliveryId: id, Sealed: true, IdempotencyKey: key("pickup")})
		}
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP:
		if now.After(d.D.GetPickedUpAt().AsTime().Add(s.Leg(d.D.GetTripKm()))) {
			_, err = s.api.ArriveAtCustomer(ctx, &dispatchv1.ArriveAtCustomerRequest{RiderId: rid, DeliveryId: id, IdempotencyKey: key("door")})
		}
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
		if now.After(d.D.GetArrivedAtCustomerAt().AsTime().Add(10 * time.Second)) {
			code := d.Code
			if code == "" {
				code = "0000"
			}
			_, err = s.api.CompleteDelivery(ctx, &dispatchv1.CompleteDeliveryRequest{
				RiderId: rid, DeliveryId: id, Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: code,
				CashCollected: d.D.GetCashToCollect(), IdempotencyKey: key("complete"),
			})
		}
	}
	if err != nil {
		s.c.Log.InfoContext(ctx, "sim: step failed", "delivery_id", id, "status", d.D.GetStatus().String(), "err", err)
	}
}

// position is where a simulated rider is now, interpolated along the current leg.
func (s *Simulator) position(d *DeliveryRow, now time.Time) *locationv1.RiderLocation {
	pickup, drop := pickupPoint(d.D), d.D.GetDropoff().GetLocation()
	from := pickup
	if d.FromLat != nil && d.FromLng != nil {
		from = &commonv1.GeoPoint{Lat: *d.FromLat, Lng: *d.FromLng}
	}
	var p *commonv1.GeoPoint
	activity := locationv1.RiderActivity_RIDER_ACTIVITY_UNSPECIFIED
	frac := func(start *timestamppb.Timestamp, leg time.Duration) float64 {
		return float64(now.Sub(start.AsTime())) / float64(leg)
	}
	switch d.D.GetStatus() {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED:
		p, activity = Lerp(from, pickup, frac(d.D.GetAssignedAt(), s.Leg(d.D.GetToPickupKm()))), locationv1.RiderActivity_RIDER_ACTIVITY_TO_RESTAURANT
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
		p, activity = pickup, locationv1.RiderActivity_RIDER_ACTIVITY_AT_RESTAURANT
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP:
		if !validPoint(drop) {
			return nil
		}
		p, activity = Lerp(pickup, drop, frac(d.D.GetPickedUpAt(), s.Leg(d.D.GetTripKm()))), locationv1.RiderActivity_RIDER_ACTIVITY_TO_CUSTOMER
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
		p, activity = drop, locationv1.RiderActivity_RIDER_ACTIVITY_AT_CUSTOMER
	}
	if !validPoint(p) {
		return nil
	}
	return &locationv1.RiderLocation{
		RiderId: d.D.GetRiderId(), Position: p, Heading: -1, SpeedMps: 5.5, AccuracyM: 8, OccurredAt: ts(now),
		DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), Activity: activity, Sequence: now.UnixMilli(),
	}
}
