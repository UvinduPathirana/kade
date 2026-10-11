package dispatch

import (
	"context"
	"errors"
	"fmt"
	"time"

	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/outbox"
)

// DB is what both *pgxpool.Pool and pgx.Tx offer.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

func ts(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}

func tsPtr(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return ts(*t)
}

func timeOf(p *timestamppb.Timestamp) *time.Time {
	if p == nil || !p.IsValid() {
		return nil
	}
	t := p.AsTime()
	return &t
}

// ---------- riders ----------

// RiderRow is a rider plus the columns that are not part of the proto.
type RiderRow struct {
	R         *dispatchv1.Rider
	Simulated bool
	LastLat   *float64
	LastLng   *float64
	LastSeen  *time.Time
}

const riderCols = `data, simulated, last_lat, last_lng, last_seen_at`

func scanRider(row pgx.Row) (*RiderRow, error) {
	var data []byte
	r := &RiderRow{R: &dispatchv1.Rider{}}
	if err := row.Scan(&data, &r.Simulated, &r.LastLat, &r.LastLng, &r.LastSeen); err != nil {
		return nil, err
	}
	if err := proto.Unmarshal(data, r.R); err != nil {
		return nil, fmt.Errorf("decode rider: %w", err)
	}
	return r, nil
}

func loadRider(ctx context.Context, db DB, id string, forUpdate bool) (*RiderRow, error) {
	q := `SELECT ` + riderCols + ` FROM riders WHERE id = $1`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	r, err := scanRider(db.QueryRow(ctx, q, id))
	if isNoRows(err) {
		return nil, errRiderNotFound.With("rider_id", id)
	}
	return r, err
}

func listRiders(ctx context.Context, db DB, where string, args ...any) ([]*RiderRow, error) {
	rows, err := db.Query(ctx, `SELECT `+riderCols+` FROM riders `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RiderRow
	for rows.Next() {
		r, err := scanRider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// saveRider upserts the rider; insertOnly=true leaves an existing row untouched (seeding).
func saveRider(ctx context.Context, db DB, r *RiderRow, insertOnly bool) error {
	stored := proto.Clone(r.R).(*dispatchv1.Rider)
	// Derived on read, never stored.
	stored.Position, stored.PositionZoneId, stored.LastSeenAt = nil, "", nil
	if stored.GetBank() != nil {
		stored.Bank.AccountNumber = ""
	}
	data, err := proto.Marshal(stored)
	if err != nil {
		return err
	}
	var userID *string
	if r.R.GetUserId() != "" {
		userID = &r.R.UserId
	}
	zones := r.R.GetZoneIds()
	if zones == nil {
		zones = []string{}
	}
	conflict := `ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name, phone = EXCLUDED.phone,
	  status = EXCLUDED.status, zone_ids = EXCLUDED.zone_ids, cash_held_minor = EXCLUDED.cash_held_minor,
	  cash_limit_minor = EXCLUDED.cash_limit_minor, cash_allowed = EXCLUDED.cash_allowed, simulated = EXCLUDED.simulated,
	  last_lat = EXCLUDED.last_lat, last_lng = EXCLUDED.last_lng, last_seen_at = EXCLUDED.last_seen_at,
	  data = EXCLUDED.data, updated_at = now()`
	if insertOnly {
		conflict = `ON CONFLICT DO NOTHING`
	}
	_, err = db.Exec(ctx, `INSERT INTO riders (id, user_id, name, phone, status, zone_ids, cash_held_minor, cash_limit_minor,
	    cash_allowed, simulated, last_lat, last_lng, last_seen_at, data)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) `+conflict,
		r.R.GetId(), userID, r.R.GetName(), r.R.GetPhone(), int16(r.R.GetStatus()), zones,
		r.R.GetCashHeld().GetAmountMinor(), r.R.GetCashLimit().GetAmountMinor(), r.R.GetCashAllowed(), r.Simulated,
		r.LastLat, r.LastLng, r.LastSeen, data)
	return err
}

// ---------- deliveries ----------

// DeliveryRow is a delivery plus internal fields the proto doesn't carry.
type DeliveryRow struct {
	D                *dispatchv1.Delivery
	CustomerID       string
	Code             string // the order's delivery code, checked at the door
	DueAt            *time.Time
	FoodReadyAt      *time.Time
	NextAttemptAt    *time.Time
	MatchingFailedAt *time.Time
	FromLat, FromLng *float64
	CustomerRating   int32
}

const deliveryCols = `data, customer_id, delivery_code, due_at, food_ready_at, next_attempt_at, matching_failed_at,
  from_lat, from_lng, customer_rating`

func scanDelivery(row pgx.Row) (*DeliveryRow, error) {
	var data []byte
	var rating int16
	d := &DeliveryRow{D: &dispatchv1.Delivery{}}
	if err := row.Scan(&data, &d.CustomerID, &d.Code, &d.DueAt, &d.FoodReadyAt, &d.NextAttemptAt, &d.MatchingFailedAt,
		&d.FromLat, &d.FromLng, &rating); err != nil {
		return nil, err
	}
	d.CustomerRating = int32(rating)
	if err := proto.Unmarshal(data, d.D); err != nil {
		return nil, fmt.Errorf("decode delivery: %w", err)
	}
	// The column is the source of truth (OrderReady only touches it).
	d.D.FoodReadyAt = nil
	if d.FoodReadyAt != nil {
		d.D.FoodReadyAt = timestamppb.New(*d.FoodReadyAt)
	}
	return d, nil
}

// loadDelivery finds a delivery by "id" or "order_id"; lock adds FOR UPDATE.
func loadDelivery(ctx context.Context, db DB, by, value string, lock bool) (*DeliveryRow, error) {
	if by != "id" && by != "order_id" {
		return nil, fmt.Errorf("loadDelivery by %q", by)
	}
	q := `SELECT ` + deliveryCols + ` FROM deliveries WHERE ` + by + ` = $1`
	if by == "id" {
		q = `SELECT ` + deliveryCols + ` FROM deliveries WHERE id::text = $1`
	}
	if lock {
		q += ` FOR UPDATE`
	}
	d, err := scanDelivery(db.QueryRow(ctx, q, value))
	if isNoRows(err) {
		return nil, errDeliveryNotFound.With(by, value)
	}
	return d, err
}

func listDeliveries(ctx context.Context, db DB, where string, args ...any) ([]*DeliveryRow, error) {
	rows, err := db.Query(ctx, `SELECT `+deliveryCols+` FROM deliveries `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*DeliveryRow
	for rows.Next() {
		d, err := scanDelivery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// saveDelivery upserts the delivery and its mirror columns; insertOnly=true keeps an existing row.
func saveDelivery(ctx context.Context, db DB, d *DeliveryRow, insertOnly bool) (inserted bool, err error) {
	data, err := proto.Marshal(d.D)
	if err != nil {
		return false, err
	}
	var riderID *string
	if d.D.GetRiderId() != "" {
		riderID = &d.D.RiderId
	}
	conflict := `ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, rider_id = EXCLUDED.rider_id,
	  cash_to_collect_minor = EXCLUDED.cash_to_collect_minor, food_ready_at = EXCLUDED.food_ready_at,
	  attempts = EXCLUDED.attempts, next_attempt_at = EXCLUDED.next_attempt_at, matching_failed_at = EXCLUDED.matching_failed_at,
	  from_lat = EXCLUDED.from_lat, from_lng = EXCLUDED.from_lng, assigned_at = EXCLUDED.assigned_at,
	  delivered_at = EXCLUDED.delivered_at, cancelled_at = COALESCE(deliveries.cancelled_at, EXCLUDED.cancelled_at), customer_rating = EXCLUDED.customer_rating,
	  pay_total_minor = EXCLUDED.pay_total_minor, data = EXCLUDED.data, updated_at = now()`
	if insertOnly {
		conflict = `ON CONFLICT DO NOTHING`
	}
	var cancelledAt *time.Time
	if d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED {
		now := time.Now()
		cancelledAt = &now
	}
	tag, err := db.Exec(ctx, `INSERT INTO deliveries (id, order_id, order_number, customer_id, restaurant_id, zone_id, status,
	    rider_id, payment, cash_to_collect_minor, delivery_code, due_at, food_ready_at, attempts, next_attempt_at,
	    matching_failed_at, from_lat, from_lng, requested_at, assigned_at, delivered_at, cancelled_at, customer_rating,
	    pay_total_minor, data)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) `+conflict,
		d.D.GetId(), d.D.GetOrderId(), d.D.GetOrderNumber(), d.CustomerID, d.D.GetPickup().GetRestaurantId(), d.D.GetZoneId(),
		int16(d.D.GetStatus()), riderID, int16(d.D.GetPayment()), d.D.GetCashToCollect().GetAmountMinor(), d.Code, d.DueAt,
		d.FoodReadyAt, d.D.GetAttempts(), d.NextAttemptAt, d.MatchingFailedAt, d.FromLat, d.FromLng,
		d.D.GetRequestedAt().AsTime(), timeOf(d.D.GetAssignedAt()), deliveredAt(d.D), cancelledAt, int16(d.CustomerRating),
		d.D.GetPay().GetTotal().GetAmountMinor(), data)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func deliveredAt(d *dispatchv1.Delivery) *time.Time {
	if d.GetStatus() != dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED {
		return nil
	}
	return timeOf(d.GetDeliveredAt())
}

// ---------- offers ----------

const offerCols = `data, status, decided_at, decline_reason`

func scanOffer(row pgx.Row) (*dispatchv1.DeliveryOffer, error) {
	var data []byte
	var status int16
	var decided *time.Time
	var reason string
	if err := row.Scan(&data, &status, &decided, &reason); err != nil {
		return nil, err
	}
	o := &dispatchv1.DeliveryOffer{}
	if err := proto.Unmarshal(data, o); err != nil {
		return nil, fmt.Errorf("decode offer: %w", err)
	}
	o.Status = dispatchv1.OfferStatus(status) // the column is authoritative (expiry updates it alone)
	o.DeclineReason = reason
	return o, nil
}

func loadOffer(ctx context.Context, db DB, id string, lock bool) (*dispatchv1.DeliveryOffer, error) {
	q := `SELECT ` + offerCols + ` FROM offers WHERE id::text = $1`
	if lock {
		q += ` FOR UPDATE`
	}
	o, err := scanOffer(db.QueryRow(ctx, q, id))
	if isNoRows(err) {
		return nil, errOfferNotFound.With("offer_id", id)
	}
	return o, err
}

func listOffers(ctx context.Context, db DB, where string, args ...any) ([]*dispatchv1.DeliveryOffer, error) {
	rows, err := db.Query(ctx, `SELECT `+offerCols+` FROM offers `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*dispatchv1.DeliveryOffer
	for rows.Next() {
		o, err := scanOffer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func insertOffer(ctx context.Context, db DB, o *dispatchv1.DeliveryOffer) error {
	data, err := proto.Marshal(o)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `INSERT INTO offers (id, delivery_id, rider_id, status, offered_at, expires_at, data)
	  VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		o.GetId(), o.GetDeliveryId(), o.GetRiderId(), int16(o.GetStatus()), o.GetOfferedAt().AsTime(), o.GetExpiresAt().AsTime(), data)
	return err
}

func setOfferStatus(ctx context.Context, db DB, id string, st dispatchv1.OfferStatus, reason string, at time.Time) error {
	_, err := db.Exec(ctx, `UPDATE offers SET status = $2, decline_reason = $3, decided_at = $4 WHERE id::text = $1`, id, int16(st), reason, at)
	return err
}

// withdrawOpenOffers closes the open offer of a delivery (cancel, reassign) and returns its rider.
func withdrawOpenOffers(ctx context.Context, db DB, deliveryID string, at time.Time) ([]string, error) {
	rows, err := db.Query(ctx, `UPDATE offers SET status = $2, decided_at = $3 WHERE delivery_id = $1 AND status = $4 RETURNING rider_id::text`,
		deliveryID, int16(dispatchv1.OfferStatus_OFFER_STATUS_WITHDRAWN), at, int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ---------- events ----------

func emit(ctx context.Context, tx DB, aggregateType, aggregateID string, msg proto.Message) error {
	t, ok := tx.(pgx.Tx)
	if !ok {
		return errors.New("events must be written inside a transaction")
	}
	_, err := outbox.Insert(ctx, t, outbox.Event{AggregateType: aggregateType, AggregateID: aggregateID, Message: msg})
	return err
}

func emitDelivery(ctx context.Context, tx DB, deliveryID string, msg proto.Message) error {
	return emit(ctx, tx, "delivery", deliveryID, msg)
}

func emitRider(ctx context.Context, tx DB, riderID string, msg proto.Message) error {
	return emit(ctx, tx, "rider", riderID, msg)
}
