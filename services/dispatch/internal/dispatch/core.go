// Package dispatch owns the rider fleet and deliveries: riders and onboarding, going online and
// offline, matching orders to riders with Redis GEO, one-rider-at-a-time offers with a 30 s
// timeout, assignment and every pickup/drop-off step, proof of delivery and cash collected.
//
// Matching starts from order.OrderAccepted (choreography). Events go out through the outbox:
// aggregatetype "delivery" → kade.delivery.events, "rider" → kade.rider.events.
package dispatch

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"strings"
	"sync"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/auth"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/idempotency"
)

// Options tune matching (see config.Config for the env names and defaults).
type Options struct {
	OfferTimeout    time.Duration
	RadiiKm         []float64
	MatchFailAfter  int
	ReofferAfter    time.Duration
	RiderStaleAfter time.Duration
	PreferReal      bool
	MaxEventAge     time.Duration
}

func (o *Options) defaults() {
	if o.OfferTimeout <= 0 {
		o.OfferTimeout = 30 * time.Second
	}
	if len(o.RadiiKm) == 0 {
		o.RadiiKm = []float64{3, 6, 12}
	}
	if o.MatchFailAfter <= 0 {
		o.MatchFailAfter = 12
	}
	if o.ReofferAfter <= 0 {
		o.ReofferAfter = 2 * time.Minute
	}
	if o.RiderStaleAfter <= 0 {
		o.RiderStaleAfter = 2 * time.Hour
	}
	if o.MaxEventAge <= 0 {
		o.MaxEventAge = 6 * time.Hour
	}
}

// CustomerMessenger delivers a rider's quick reply to the customer (notification service).
type CustomerMessenger func(ctx context.Context, d *DeliveryRow, riderFirstName, text, messageID string) error

// PositionReporter sends simulated rider positions through location (so realtime sees them).
type PositionReporter func(ctx context.Context, locs []*locationv1.RiderLocation) error

// Core holds what every API and background loop shares.
type Core struct {
	Pool  *pgxpool.Pool
	Fleet *Fleet
	Opt   Options
	Log   *slog.Logger

	Messenger CustomerMessenger // optional
	Reporter  PositionReporter  // optional

	now  func() time.Time
	wake chan struct{}

	userRiders sync.Map // Keycloak sub → rider id (never changes once set)
}

func NewCore(pool *pgxpool.Pool, fleet *Fleet, opt Options, log *slog.Logger) *Core {
	opt.defaults()
	return &Core{Pool: pool, Fleet: fleet, Opt: opt, Log: log, now: time.Now, wake: make(chan struct{}, 1)}
}

// Now is the clock (UTC, microsecond precision like Postgres).
func (c *Core) Now() time.Time { return c.now().UTC().Truncate(time.Microsecond) }

// Wake nudges the matcher to run now instead of at its next tick.
func (c *Core) Wake() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *Core) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, c.Pool, fn)
}

// ---------- identity ----------

var staffRoles = []string{"ops", "admin", "support", "finance"}

// requireStaff lets internal calls (no identity) and staff through.
func requireStaff(ctx context.Context) error {
	id := auth.FromContext(ctx)
	if !id.Authenticated() || id.HasRole(staffRoles...) {
		return nil
	}
	return errStaffOnly
}

// riderForUser finds the rider record of a Keycloak user.
func (c *Core) riderForUser(ctx context.Context, userID string) (string, error) {
	if v, ok := c.userRiders.Load(userID); ok {
		return v.(string), nil
	}
	var id string
	err := c.Pool.QueryRow(ctx, `SELECT id::text FROM riders WHERE user_id = $1`, userID).Scan(&id)
	if isNoRows(err) {
		return "", errRiderNotFound.With("user_id", userID)
	}
	if err != nil {
		return "", err
	}
	c.userRiders.Store(userID, id)
	return id, nil
}

// resolveRider returns the rider a rider-app call acts for: the request's rider_id, or the
// caller's own rider when it is empty. Riders may only act for themselves; staff and internal
// callers may act for anyone.
func (c *Core) resolveRider(ctx context.Context, riderID string) (string, error) {
	caller := auth.FromContext(ctx)
	if riderID == "" {
		if !caller.Authenticated() {
			return "", errRiderIDRequired
		}
		return c.riderForUser(ctx, caller.UserID)
	}
	if caller.Authenticated() && caller.HasRole("rider") && !caller.HasRole(staffRoles...) {
		own, err := c.riderForUser(ctx, caller.UserID)
		if err != nil {
			return "", err
		}
		if own != riderID {
			return "", errRiderMismatch
		}
	}
	return riderID, nil
}

// ---------- idempotency ----------

// once runs fn inside tx under an idempotency key (if given). On a replay it decodes the stored
// response into resp and skips fn; fn's response is stored on success.
func once(ctx context.Context, tx pgx.Tx, scope, key string, req proto.Message, resp proto.Message, fn func() error) (replayed bool, err error) {
	if key == "" {
		return false, fn()
	}
	prior, replay, err := idempotency.Claim(ctx, tx, scope, key, idempotency.Hash(req))
	if errors.Is(err, idempotency.ErrKeyReused) {
		return false, errKeyReused
	}
	if err != nil {
		return false, err
	}
	if replay {
		return true, proto.Unmarshal(prior, resp)
	}
	if err := fn(); err != nil {
		return false, err
	}
	return false, idempotency.Complete(ctx, tx, scope, key, resp)
}

// withoutKey clones req with its idempotency_key cleared, for hashing.
func withoutKey[T proto.Message](req T, clear func(T)) T {
	c := proto.Clone(req).(T)
	clear(c)
	return c
}

// ---------- riders: read model ----------

// enrich fills the derived fields of riders for reads: position (location's last known, else
// dispatch's index, else the last stored), its zone, last seen and trips this week.
func (c *Core) enrich(ctx context.Context, rows []*RiderRow) []*dispatchv1.Rider {
	out := make([]*dispatchv1.Rider, len(rows))
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.R.GetId()
	}
	fixes, err := c.Fleet.Positions(ctx, ids)
	if err != nil {
		c.Log.WarnContext(ctx, "reading rider positions failed", "err", err)
	}
	weekTrips := c.tripsThisWeek(ctx, ids)
	for i, row := range rows {
		r := proto.Clone(row.R).(*dispatchv1.Rider)
		if fx, ok := fixes[r.GetId()]; ok {
			r.Position = fx.Position
			r.LastSeenAt = ts(fx.Seen)
		} else if row.LastLat != nil && row.LastLng != nil {
			r.Position = &commonv1.GeoPoint{Lat: *row.LastLat, Lng: *row.LastLng}
			r.LastSeenAt = tsPtr(row.LastSeen)
		}
		r.PositionZoneId = ZoneOf(r.GetPosition())
		if n, ok := weekTrips[r.GetId()]; ok && n > r.GetTripsWeek() {
			r.TripsWeek = n
		}
		if r.GetBank() != nil {
			r.Bank.AccountNumber = ""
		}
		out[i] = r
	}
	return out
}

// tripsThisWeek counts deliveries completed since Monday 00:00 Colombo time.
func (c *Core) tripsThisWeek(ctx context.Context, riderIDs []string) map[string]int32 {
	out := map[string]int32{}
	if len(riderIDs) == 0 {
		return out
	}
	rows, err := c.Pool.Query(ctx, `SELECT rider_id::text, count(*) FROM deliveries
	  WHERE rider_id::text = ANY($1) AND status = $2 AND delivered_at >= $3 GROUP BY rider_id`,
		riderIDs, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED), WeekStart(c.Now()))
	if err != nil {
		c.Log.WarnContext(ctx, "counting trips failed", "err", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int32
		if rows.Scan(&id, &n) == nil {
			out[id] = n
		}
	}
	return out
}

// WeekStart is Monday 00:00 in Colombo for the week containing t.
func WeekStart(t time.Time) time.Time {
	l := t.In(Colombo)
	day := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, Colombo)
	return day.AddDate(0, 0, -((int(day.Weekday()) + 6) % 7))
}

// DayStart is 00:00 Colombo time of t's day.
func DayStart(t time.Time) time.Time {
	l := t.In(Colombo)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, Colombo)
}

func (c *Core) riderView(ctx context.Context, r *RiderRow) *dispatchv1.Rider {
	return c.enrich(ctx, []*RiderRow{r})[0]
}

// Card is how customers and restaurants see a rider.
func Card(r *dispatchv1.Rider) *dispatchv1.RiderCard {
	return &dispatchv1.RiderCard{
		RiderId: r.GetId(), Name: r.GetName(), FirstName: r.GetFirstName(), Rating: r.GetRating(),
		Vehicle: r.GetVehicle().GetModel(), Plate: r.GetVehicle().GetPlate(), MaskedPhone: r.GetMaskedPhone(), Phone: r.GetPhone(),
	}
}

// setRiderStatus changes the status (and reason) and emits RiderStatusChanged in tx.
func (c *Core) setRiderStatus(ctx context.Context, tx pgx.Tx, r *RiderRow, st dispatchv1.RiderStatus, reason string, now time.Time) error {
	prev := r.R.GetStatus()
	r.R.Status, r.R.StatusReason = st, reason
	if err := saveRider(ctx, tx, r, false); err != nil {
		return err
	}
	if prev == st {
		return nil
	}
	return emitRider(ctx, tx, r.R.GetId(), &dispatchv1.RiderStatusChanged{
		RiderId: r.R.GetId(), Status: st, Previous: prev, Reason: reason, ZoneIds: r.R.GetZoneIds(),
		Actor: actor(ctx), OccurredAt: ts(now),
	})
}

func actor(ctx context.Context) *commonv1.Actor {
	id := auth.FromContext(ctx)
	if !id.Authenticated() {
		return nil
	}
	return &commonv1.Actor{UserId: id.UserID, Roles: id.Roles, OutletId: id.OutletID}
}

// lastPosition is the best known position of one rider, or nil.
func (c *Core) lastPosition(ctx context.Context, r *RiderRow) *commonv1.GeoPoint {
	if fx, err := c.Fleet.Positions(ctx, []string{r.R.GetId()}); err == nil {
		if f, ok := fx[r.R.GetId()]; ok {
			return f.Position
		}
	}
	if r.LastLat != nil && r.LastLng != nil {
		return &commonv1.GeoPoint{Lat: *r.LastLat, Lng: *r.LastLng}
	}
	return nil
}

// ---------- small helpers ----------

// hasReason reports whether err is an apperr with that reason.
func hasReason(err error, reason string) bool {
	var ae *apperr.Error
	return errors.As(err, &ae) && ae.Reason == reason
}

func firstName(name string) string {
	if f := strings.Fields(name); len(f) > 0 {
		return f[0]
	}
	return ""
}

// maskedPhone derives a stable proxy number ("+94 11 520 3381") from a seed string.
func maskedPhone(prefix, seed string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(seed))
	return fmt.Sprintf("+94 11 520 %s%03d", prefix, h.Sum32()%1000)
}

func digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func clampPage(size int32, def, maxSize int) int {
	if size <= 0 {
		return def
	}
	return min(int(size), maxSize)
}

func pageOffset(token string) int {
	var n int
	_, _ = fmt.Sscanf(token, "%d", &n)
	return max(0, n)
}
