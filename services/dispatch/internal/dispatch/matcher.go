package dispatch

import (
	"context"
	"math"
	"sort"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
)

// Matching, in one place:
//
//  1. A delivery is "due" when it is MATCHING (or UNMATCHED) and next_attempt_at has passed.
//     OrderAccepted creates it due now; a decline or an expired offer makes it due again at once.
//  2. Candidates come from the Redis GEO index of available riders (online, idle), searched in
//     growing rings around the restaurant (MATCH_RADII_KM, default 3 → 6 → 12 km), nearest first.
//  3. Postgres has the final say: the rider must still be ONLINE, have no other open offer, not
//     have seen this job in the last REOFFER_AFTER, be allowed cash for a cash order (ledger's
//     cash limit), and have a fresh position (simulated riders are exempt).
//  4. Riders with a login (real people such as Nimal) rank ahead of the simulated demo fleet when
//     PREFER_REAL_RIDERS is on; then nearest first.
//  5. One offer at a time, 30 s to answer (OFFER_TIMEOUT). Expiry runs every tick: the offer is
//     EXPIRED, DeliveryOfferExpired is published and the delivery is due again.
//  6. No candidate: retry with backoff 5 s, 10 s, 20 s, then every 30 s. After MATCH_FAIL_AFTER
//     rounds the delivery becomes UNMATCHED and DeliveryMatchingFailed tells ops (the admin live
//     dashboard lists it); matching keeps retrying every 30 s until a rider takes it or ops
//     reassign it.
//
// The matcher is safe with several replicas: due deliveries are claimed FOR UPDATE SKIP LOCKED and
// the unique partial indexes on offers allow one open offer per delivery and per rider.

// RunMatcher ticks every second (or when woken) until ctx ends.
func (c *Core) RunMatcher(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-c.wake:
		}
		c.MatchTick(ctx)
	}
}

// MatchTick expires overdue offers, then tries every due delivery once.
func (c *Core) MatchTick(ctx context.Context) {
	if err := c.expireOffers(ctx); err != nil && ctx.Err() == nil {
		c.Log.WarnContext(ctx, "expiring offers failed", "err", err)
	}
	rows, err := c.Pool.Query(ctx, `SELECT id::text FROM deliveries WHERE status IN ($1, $2) AND next_attempt_at <= $3
	  ORDER BY next_attempt_at LIMIT 50`,
		int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED), c.Now())
	if err != nil {
		if ctx.Err() == nil {
			c.Log.WarnContext(ctx, "listing due deliveries failed", "err", err)
		}
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}
	for _, id := range ids {
		if err := c.matchDelivery(ctx, id); err != nil && ctx.Err() == nil {
			c.Log.WarnContext(ctx, "matching failed", "delivery_id", id, "err", err)
		}
	}
}

func (c *Core) expireOffers(ctx context.Context) error {
	return c.inTx(ctx, func(tx pgx.Tx) error {
		now := c.Now()
		rows, err := tx.Query(ctx, `UPDATE offers SET status = $1, decided_at = $2 WHERE status = $3 AND expires_at <= $2
		  RETURNING id::text, delivery_id::text, rider_id::text`,
			int16(dispatchv1.OfferStatus_OFFER_STATUS_EXPIRED), now, int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED))
		if err != nil {
			return err
		}
		type exp struct{ offer, delivery, rider string }
		var expired []exp
		for rows.Next() {
			var e exp
			if err := rows.Scan(&e.offer, &e.delivery, &e.rider); err != nil {
				rows.Close()
				return err
			}
			expired = append(expired, e)
		}
		rows.Close()
		for _, e := range expired {
			d, err := loadDelivery(ctx, tx, "id", e.delivery, true)
			if err != nil {
				return err
			}
			if err := emitDelivery(ctx, tx, e.delivery, &dispatchv1.DeliveryOfferExpired{
				DeliveryId: e.delivery, OrderId: d.D.GetOrderId(), OfferId: e.offer, RiderId: e.rider, OccurredAt: ts(now),
			}); err != nil {
				return err
			}
			if isMatching(d.D.GetStatus()) {
				d.NextAttemptAt = &now
				if _, err := saveDelivery(ctx, tx, d, false); err != nil {
					return err
				}
			}
			c.Log.InfoContext(ctx, "offer expired", "offer_id", e.offer, "delivery_id", e.delivery, "rider_id", e.rider)
		}
		return nil
	})
}

func isMatching(s dispatchv1.DeliveryStatus) bool {
	return s == dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING || s == dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED
}

// MatchBackoff is the wait before the next round after an empty one.
func MatchBackoff(attempts int32) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	return time.Duration(math.Min(30, 5*math.Pow(2, float64(min(attempts-1, 3))))) * time.Second
}

func (c *Core) matchDelivery(ctx context.Context, id string) error {
	return c.inTx(ctx, func(tx pgx.Tx) error {
		now := c.Now()
		d, err := scanDelivery(tx.QueryRow(ctx, `SELECT `+deliveryCols+` FROM deliveries
		  WHERE id::text = $1 AND status IN ($2, $3) AND next_attempt_at <= $4 FOR UPDATE SKIP LOCKED`,
			id, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED), now))
		if isNoRows(err) {
			return nil // taken by another replica, or no longer due
		}
		if err != nil {
			return err
		}
		d.D.Attempts++
		cands, err := c.findCandidates(ctx, tx, d, now)
		if err != nil {
			return err
		}
		for _, cand := range cands {
			offer := c.BuildOffer(d, cand, now)
			sp, err := tx.Begin(ctx) // savepoint: the rider may have just got another offer
			if err != nil {
				return err
			}
			if err := insertOffer(ctx, sp, offer); err != nil {
				_ = sp.Rollback(ctx)
				if isUniqueViolation(err) {
					continue
				}
				return err
			}
			if err := sp.Commit(ctx); err != nil {
				return err
			}
			d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING
			d.NextAttemptAt = nil
			if _, err := saveDelivery(ctx, tx, d, false); err != nil {
				return err
			}
			c.Log.InfoContext(ctx, "offer sent", "delivery_id", id, "order_number", d.D.GetOrderNumber(), "rider_id", cand.RiderID,
				"km", cand.Km, "real", cand.Real, "attempt", d.D.GetAttempts())
			return emitDelivery(ctx, tx, id, &dispatchv1.DeliveryOfferSent{DeliveryId: id, OrderId: d.D.GetOrderId(), Offer: offer, OccurredAt: ts(now)})
		}

		// Nobody: back off, and tell ops once the rounds are used up.
		next := now.Add(MatchBackoff(d.D.GetAttempts()))
		d.NextAttemptAt = &next
		if int(d.D.GetAttempts()) >= c.Opt.MatchFailAfter && d.MatchingFailedAt == nil {
			d.MatchingFailedAt = &now
			d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED
			c.Log.WarnContext(ctx, "no rider found, ops attention needed", "delivery_id", id, "order_number", d.D.GetOrderNumber(), "attempts", d.D.GetAttempts())
			if err := emitDelivery(ctx, tx, id, &dispatchv1.DeliveryMatchingFailed{
				DeliveryId: id, OrderId: d.D.GetOrderId(), Attempts: d.D.GetAttempts(), OccurredAt: ts(now),
			}); err != nil {
				return err
			}
		}
		_, err = saveDelivery(ctx, tx, d, false)
		return err
	})
}

// Ranked is a candidate rider after the database checks.
type Ranked struct {
	Candidate
	Real      bool // has a login (user_id): a person, not the demo fleet
	Simulated bool
}

// RankCandidates orders candidates: real riders first when preferReal, then nearest.
func RankCandidates(cs []Ranked, preferReal bool) []Ranked {
	out := append([]Ranked(nil), cs...)
	sort.SliceStable(out, func(i, j int) bool {
		if preferReal && out[i].Real != out[j].Real {
			return out[i].Real
		}
		return out[i].Km < out[j].Km
	})
	return out
}

func (c *Core) findCandidates(ctx context.Context, tx pgx.Tx, d *DeliveryRow, now time.Time) ([]Ranked, error) {
	center := pickupPoint(d.D)
	cash := d.D.GetPayment() == commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH
	for _, radius := range c.Opt.RadiiKm {
		hits, err := c.Fleet.Nearby(ctx, center, radius, 40)
		if err != nil {
			return nil, err
		}
		if len(hits) == 0 {
			continue
		}
		byID := make(map[string]Candidate, len(hits))
		ids := make([]string, len(hits))
		for i, h := range hits {
			byID[h.RiderID], ids[i] = h, h.RiderID
		}
		rows, err := tx.Query(ctx, `SELECT r.id::text, r.user_id IS NOT NULL, r.cash_allowed, r.simulated FROM riders r
		  WHERE r.id::text = ANY($1) AND r.status = $2
		    AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.rider_id = r.id AND o.status = $3)
		    AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.rider_id = r.id AND o.delivery_id::text = $4 AND o.offered_at > $5)`,
			ids, int16(dispatchv1.RiderStatus_RIDER_STATUS_ONLINE), int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED),
			d.D.GetId(), now.Add(-c.Opt.ReofferAfter))
		if err != nil {
			return nil, err
		}
		var eligible []Ranked
		for rows.Next() {
			var id string
			var real, cashAllowed, simulated bool
			if err := rows.Scan(&id, &real, &cashAllowed, &simulated); err != nil {
				rows.Close()
				return nil, err
			}
			cand := byID[id]
			if cash && !cashAllowed {
				continue
			}
			if !simulated && (cand.Seen.IsZero() || now.Sub(cand.Seen) > c.Opt.RiderStaleAfter) {
				continue
			}
			eligible = append(eligible, Ranked{Candidate: cand, Real: real, Simulated: simulated})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		if len(eligible) > 0 {
			return RankCandidates(eligible, c.Opt.PreferReal), nil
		}
	}
	return nil, nil
}

// pickupPoint is the restaurant, else the delivery zone's centre, else Kollupitiya.
func pickupPoint(d *dispatchv1.Delivery) *commonv1.GeoPoint {
	if p := d.GetPickup().GetLocation(); validPoint(p) {
		return p
	}
	if z, ok := ZoneByID(d.GetZoneId()); ok {
		return &commonv1.GeoPoint{Lat: z.Lat, Lng: z.Lng}
	}
	z, _ := ZoneByID("c03")
	return &commonv1.GeoPoint{Lat: z.Lat, Lng: z.Lng}
}

// BuildOffer prices the job for this rider: pickup leg from where they are, pay, minutes, and how
// long the kitchen still needs if they would arrive early.
func (c *Core) BuildOffer(d *DeliveryRow, cand Ranked, now time.Time) *dispatchv1.DeliveryOffer {
	preview := proto.Clone(d.D).(*dispatchv1.Delivery)
	preview.RiderId = ""
	toPickup := RoadKm(cand.Position, pickupPoint(d.D))
	preview.ToPickupKm = toPickup
	preview.Pay = ComputePay(toPickup+preview.GetTripKm(), preview.GetPay().GetTip().GetAmountMinor(), now)
	preview.Minutes = TravelMinutes(toPickup+preview.GetTripKm()) + HandoverMinutes
	var notReady int32
	if rb := preview.GetReadyBy(); rb != nil && rb.IsValid() {
		arrive := now.Add(time.Duration(TravelMinutes(toPickup)) * time.Minute)
		if wait := rb.AsTime().Sub(arrive); wait > 0 {
			notReady = int32(math.Ceil(wait.Minutes()))
		}
	}
	id, _ := uuid.NewV7()
	return &dispatchv1.DeliveryOffer{
		Id: id.String(), DeliveryId: d.D.GetId(), RiderId: cand.RiderID, Delivery: preview, From: cand.Position,
		OfferedAt: ts(now), ExpiresAt: ts(now.Add(c.Opt.OfferTimeout)), Status: dispatchv1.OfferStatus_OFFER_STATUS_OFFERED,
		NotReadyMinutes: notReady,
	}
}

// HandoverMinutes covers parking, the counter and the door.
const HandoverMinutes = 5
