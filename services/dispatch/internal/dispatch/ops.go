package dispatch

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/jackc/pgx/v5"
)

// OpsAPI is kade.dispatch.v1.DispatchOpsService: the admin console's live dashboard and
// order interventions.
type OpsAPI struct {
	dispatchv1.UnimplementedDispatchOpsServiceServer
	c *Core
}

func NewOpsAPI(c *Core) *OpsAPI { return &OpsAPI{c: c} }

// closedZones mirrors pricing's seed (Mount Lavinia closed). pricing owns zone opening.
var closedZones = map[string]bool{"mtl": true}

func (a *OpsAPI) GetLiveSnapshot(ctx context.Context, _ *dispatchv1.GetLiveSnapshotRequest) (*dispatchv1.GetLiveSnapshotResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	c := a.c
	now := c.Now()
	open, err := listDeliveries(ctx, c.Pool, `WHERE status NOT IN ($1, $2) ORDER BY requested_at`,
		int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED))
	if err != nil {
		return nil, err
	}
	riders, err := listRiders(ctx, c.Pool, `WHERE status IN ($1, $2)`,
		int16(dispatchv1.RiderStatus_RIDER_STATUS_ONLINE), int16(dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB))
	if err != nil {
		return nil, err
	}
	overCash, err := listRiders(ctx, c.Pool, `WHERE cash_held_minor > cash_limit_minor AND status <> $1 ORDER BY cash_held_minor DESC LIMIT 10`,
		int16(dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED))
	if err != nil {
		return nil, err
	}
	stats, err := c.dayStats(ctx, now)
	if err != nil {
		return nil, err
	}
	snap := BuildSnapshot(now, open, c.enrich(ctx, riders), c.enrich(ctx, overCash), stats)
	return &dispatchv1.GetLiveSnapshotResponse{Snapshot: snap}, nil
}

// DayStats are today's (and last week's same day) totals for the dashboard.
type DayStats struct {
	OrdersToday, CancellationsToday int32
	AvgDeliveryMinutes              float64
	RequestedToday, RequestedLastWk []time.Time
}

func (c *Core) dayStats(ctx context.Context, now time.Time) (DayStats, error) {
	var s DayStats
	today := DayStart(now)
	lastWeek := today.AddDate(0, 0, -7)
	var avg *float64
	err := c.Pool.QueryRow(ctx, `SELECT
	    count(*) FILTER (WHERE requested_at >= $1),
	    count(*) FILTER (WHERE status = $2 AND cancelled_at >= $1),
	    avg(extract(epoch FROM delivered_at - requested_at) / 60) FILTER (WHERE status = $3 AND delivered_at >= $1)
	  FROM deliveries WHERE requested_at >= $1 OR cancelled_at >= $1 OR delivered_at >= $1`,
		today, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED)).
		Scan(&s.OrdersToday, &s.CancellationsToday, &avg)
	if err != nil {
		return s, err
	}
	if avg != nil {
		s.AvgDeliveryMinutes = math.Round(*avg*10) / 10
	}
	rows, err := c.Pool.Query(ctx, `SELECT requested_at FROM deliveries WHERE (requested_at >= $1 AND requested_at < $2) OR requested_at >= $3`,
		lastWeek, lastWeek.AddDate(0, 0, 1), today)
	if err != nil {
		return s, err
	}
	times, err := pgx.CollectRows(rows, pgx.RowTo[time.Time])
	if err != nil {
		return s, err
	}
	for _, t := range times {
		if t.Before(today) {
			s.RequestedLastWk = append(s.RequestedLastWk, t)
		} else {
			s.RequestedToday = append(s.RequestedToday, t)
		}
	}
	return s, nil
}

func rupees(minor int64) string {
	s := fmt.Sprint(minor / 100)
	var b strings.Builder
	for i, ch := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(ch)
	}
	return "Rs " + b.String()
}

// BuildSnapshot assembles the live dashboard from open deliveries and online riders.
func BuildSnapshot(now time.Time, open []*DeliveryRow, online []*dispatchv1.Rider, overCash []*dispatchv1.Rider, st DayStats) *dispatchv1.LiveSnapshot {
	s := &dispatchv1.LiveSnapshot{At: ts(now), InProgress: int32(len(open)), OrdersToday: st.OrdersToday,
		CancellationsToday: st.CancellationsToday, AvgDeliveryMinutes: st.AvgDeliveryMinutes, RidersOnline: int32(len(online))}

	riderPos := map[string]*commonv1.GeoPoint{}
	ridersByZone := map[string]int32{}
	for _, r := range online {
		zone := r.GetPositionZoneId()
		if zone == "" && len(r.GetZoneIds()) > 0 {
			zone = r.GetZoneIds()[0]
		}
		ridersByZone[zone]++
		if validPoint(r.GetPosition()) {
			riderPos[r.GetId()] = r.GetPosition()
			if r.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_ONLINE {
				s.Dots = append(s.Dots, &dispatchv1.MapDot{Id: r.GetId(), Kind: dispatchv1.DotKind_DOT_KIND_RIDER, ZoneId: zone,
					Location: r.GetPosition(), Label: r.GetFirstName()})
			}
		}
	}

	ordersByZone := map[string]int32{}
	for _, d := range open {
		ordersByZone[d.D.GetZoneId()]++
		late := d.DueAt != nil && now.After(*d.DueAt)
		waiting := isMatching(d.D.GetStatus())
		if waiting {
			s.WaitingForRider++
		}
		if late {
			s.Late++
			mins := int32(now.Sub(*d.DueAt).Minutes())
			s.Attention = append(s.Attention, &dispatchv1.AttentionItem{
				Id: "late:" + d.D.GetOrderId(), Kind: dispatchv1.AttentionKind_ATTENTION_KIND_LATE_ORDER,
				Title: d.D.GetOrderNumber() + " is running late", Detail: fmt.Sprintf("%d min past the promised time · %s", mins, statusLabel(d.D.GetStatus())),
				Severity: 60 + min(mins, 30), RecordType: "order", RecordId: d.D.GetOrderId(),
			})
		}
		if d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED {
			waited := int32(now.Sub(d.D.GetRequestedAt().AsTime()).Minutes())
			s.Attention = append(s.Attention, &dispatchv1.AttentionItem{
				Id: "unmatched:" + d.D.GetId(), Kind: dispatchv1.AttentionKind_ATTENTION_KIND_UNMATCHED_DELIVERY,
				Title: "No rider for " + d.D.GetOrderNumber(), Detail: fmt.Sprintf("%d matching rounds, waiting %d min at %s", d.D.GetAttempts(), waited, d.D.GetPickup().GetName()),
				Severity: 90, RecordType: "order", RecordId: d.D.GetOrderId(), Phone: d.D.GetPickup().GetPhone(),
			})
		}
		dot := &dispatchv1.MapDot{Id: d.D.GetId(), ZoneId: d.D.GetZoneId(), Label: d.D.GetOrderNumber()}
		switch {
		case late:
			dot.Kind = dispatchv1.DotKind_DOT_KIND_LATE
		case waiting || d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED || d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
			dot.Kind = dispatchv1.DotKind_DOT_KIND_WAITING
		default:
			dot.Kind = dispatchv1.DotKind_DOT_KIND_ON_THE_WAY
		}
		dot.Location = d.D.GetPickup().GetLocation()
		if p, ok := riderPos[d.D.GetRiderId()]; ok && dot.Kind != dispatchv1.DotKind_DOT_KIND_WAITING {
			dot.Location = p
		}
		if validPoint(dot.Location) {
			s.Dots = append(s.Dots, dot)
		}
	}

	var shortest *dispatchv1.ZoneLoad
	shortBy := int32(0)
	for _, z := range Zones {
		needed := z.RidersNeeded + max(0, ordersByZone[z.ID]-z.RidersNeeded)
		zl := &dispatchv1.ZoneLoad{ZoneId: z.ID, ZoneCode: z.Code, Orders: ordersByZone[z.ID], Riders: ridersByZone[z.ID],
			RidersNeeded: needed, Open: !closedZones[z.ID]}
		s.Zones = append(s.Zones, zl)
		if !zl.GetOpen() {
			continue
		}
		s.RidersNeeded += needed
		if short := needed - zl.GetRiders(); short > shortBy {
			shortest, shortBy = zl, short
		}
		if short := needed - zl.GetRiders(); short >= 2 {
			s.Attention = append(s.Attention, &dispatchv1.AttentionItem{
				Id: "short:" + z.ID, Kind: dispatchv1.AttentionKind_ATTENTION_KIND_RIDERS_SHORT,
				Title: fmt.Sprintf("%s is %d riders short", z.Name, short), Detail: fmt.Sprintf("%d online, %d needed, %d orders open", zl.GetRiders(), needed, zl.GetOrders()),
				Severity: 30 + short*5, RecordType: "zone", RecordId: z.ID,
			})
		}
	}
	if shortest != nil {
		s.ShortestZoneCode, s.ShortestZoneShort = shortest.GetZoneCode(), shortBy
	}

	for _, r := range overCash {
		s.Attention = append(s.Attention, &dispatchv1.AttentionItem{
			Id: "cash:" + r.GetId(), Kind: dispatchv1.AttentionKind_ATTENTION_KIND_RIDER_CASH,
			Title:    fmt.Sprintf("%s is holding %s", r.GetName(), rupees(r.GetCashHeld().GetAmountMinor())),
			Detail:   fmt.Sprintf("Limit %s · card orders only until they deposit", rupees(r.GetCashLimit().GetAmountMinor())),
			Severity: 50, RecordType: "rider", RecordId: r.GetId(), Phone: r.GetPhone(),
		})
	}
	sort.SliceStable(s.Attention, func(i, j int) bool { return s.Attention[i].GetSeverity() > s.Attention[j].GetSeverity() })

	for h := 0; h <= now.In(Colombo).Hour(); h++ {
		s.OrdersByHour = append(s.OrdersByHour, &dispatchv1.HourCount{Hour: int32(h)})
	}
	for _, t := range st.RequestedToday {
		if h := t.In(Colombo).Hour(); h < len(s.OrdersByHour) {
			s.OrdersByHour[h].Today++
		}
	}
	for _, t := range st.RequestedLastWk {
		if h := t.In(Colombo).Hour(); h < len(s.OrdersByHour) {
			s.OrdersByHour[h].LastWeek++
		}
	}
	return s
}

func statusLabel(s dispatchv1.DeliveryStatus) string {
	switch s {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING, dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED:
		return "waiting for a rider"
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED:
		return "rider on the way to the restaurant"
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
		return "rider at the restaurant"
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP:
		return "on the way to the customer"
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
		return "rider at the door"
	}
	return strings.ToLower(strings.TrimPrefix(s.String(), "DELIVERY_STATUS_"))
}

func (a *OpsAPI) ListNearbyRiders(ctx context.Context, req *dispatchv1.ListNearbyRidersRequest) (*dispatchv1.ListNearbyRidersResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	if req.GetOrderId() == "" {
		return nil, errOrderIDRequired
	}
	c := a.c
	d, err := loadDelivery(ctx, c.Pool, "order_id", req.GetOrderId(), false)
	if err != nil {
		return nil, err
	}
	limit := int(req.GetLimit())
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	hits, err := c.Fleet.Nearby(ctx, pickupPoint(d.D), 15, limit*2)
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return &dispatchv1.ListNearbyRidersResponse{}, nil
	}
	ids := make([]string, len(hits))
	for i, h := range hits {
		ids[i] = h.RiderID
	}
	rows, err := listRiders(ctx, c.Pool, `WHERE id::text = ANY($1) AND status = $2`, ids, int16(dispatchv1.RiderStatus_RIDER_STATUS_ONLINE))
	if err != nil {
		return nil, err
	}
	byID := map[string]*dispatchv1.Rider{}
	for _, r := range c.enrich(ctx, rows) {
		byID[r.GetId()] = r
	}
	resp := &dispatchv1.ListNearbyRidersResponse{}
	for _, h := range hits {
		r, ok := byID[h.RiderID]
		if !ok {
			continue
		}
		km := round1(h.Km)
		resp.Riders = append(resp.Riders, &dispatchv1.NearbyRider{Rider: r, Km: km, Minutes: TravelMinutes(km * RoadFactor)})
		if len(resp.Riders) == limit {
			break
		}
	}
	return resp, nil
}

func (a *OpsAPI) ReassignRider(ctx context.Context, req *dispatchv1.ReassignRiderRequest) (*dispatchv1.ReassignRiderResponse, error) {
	if err := requireStaff(ctx); err != nil {
		return nil, err
	}
	if req.GetOrderId() == "" {
		return nil, errOrderIDRequired
	}
	c := a.c
	resp := &dispatchv1.ReassignRiderResponse{}
	var freed, taken string
	err := c.inTx(ctx, func(tx pgx.Tx) error {
		key := ""
		if req.GetIdempotencyKey() != "" {
			key = req.GetOrderId() + ":" + req.GetIdempotencyKey()
		}
		hashReq := withoutKey(req, func(r *dispatchv1.ReassignRiderRequest) { r.IdempotencyKey = "" })
		_, err := once(ctx, tx, "ReassignRider", key, hashReq, resp, func() error {
			now := c.Now()
			d, err := loadDelivery(ctx, tx, "order_id", req.GetOrderId(), true)
			if err != nil {
				return err
			}
			switch d.D.GetStatus() {
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED:
				return errDeliveryNotFound.With("reason", "already delivered")
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED:
				return errDeliveryCancelled
			}
			if req.GetRiderId() != "" && req.GetRiderId() == d.D.GetRiderId() {
				resp.Delivery = d.D
				return nil
			}
			reason := strings.TrimSpace(req.GetReason())
			if reason == "" {
				reason = "Reassigned by ops"
			}
			if by := strings.TrimSpace(req.GetBy()); by != "" {
				reason += " (" + by + ")"
			}
			if _, err := withdrawOpenOffers(ctx, tx, d.D.GetId(), now); err != nil {
				return err
			}
			if old := d.D.GetRiderId(); old != "" {
				if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.RiderUnassigned{
					DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), RiderId: old, Reason: reason, OccurredAt: ts(now),
				}); err != nil {
					return err
				}
				if err := c.freeRider(ctx, tx, old, now); err != nil {
					return err
				}
				freed = old
			}
			if req.GetRiderId() == "" {
				// Back to matching: dispatch offers it to the next rider.
				d.D.RiderId, d.D.Status = "", dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING
				d.D.AssignedAt, d.D.ArrivedAtRestaurantAt, d.D.PickedUpAt, d.D.ArrivedAtCustomerAt = nil, nil, nil, nil
				d.NextAttemptAt = &now
				if _, err := saveDelivery(ctx, tx, d, false); err != nil {
					return err
				}
				resp.Delivery = d.D
				return nil
			}
			r, err := loadRider(ctx, tx, req.GetRiderId(), true)
			if err != nil {
				return err
			}
			switch r.R.GetStatus() {
			case dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED:
				return errRiderSuspended
			case dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB:
				return errRiderBusy
			}
			if _, err := c.withdrawRiderOffer(ctx, tx, r.R.GetId(), now); err != nil {
				return err
			}
			if err := c.assign(ctx, tx, d, r, nil, nil, true, reason, now); err != nil {
				return err
			}
			taken = r.R.GetId()
			resp.Delivery = d.D
			return nil
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	if taken != "" {
		_ = c.Fleet.MakeUnavailable(ctx, taken)
	}
	if freed != "" {
		c.restoreAvailability(ctx, freed)
	}
	c.Wake()
	return resp, nil
}

func (a *OpsAPI) GetDelivery(ctx context.Context, req *dispatchv1.GetDeliveryRequest) (*dispatchv1.GetDeliveryResponse, error) {
	c := a.c
	var (
		d   *DeliveryRow
		err error
	)
	switch {
	case req.GetDeliveryId() != "":
		d, err = loadDelivery(ctx, c.Pool, "id", req.GetDeliveryId(), false)
	case req.GetOrderId() != "":
		d, err = loadDelivery(ctx, c.Pool, "order_id", req.GetOrderId(), false)
	default:
		return nil, errIDRequired
	}
	if err != nil {
		return nil, err
	}
	offers, err := listOffers(ctx, c.Pool, `WHERE delivery_id::text = $1 ORDER BY offered_at`, d.D.GetId())
	if err != nil {
		return nil, err
	}
	return &dispatchv1.GetDeliveryResponse{Delivery: d.D, Offers: offers}, nil
}
