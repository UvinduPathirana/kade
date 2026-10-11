package dispatch

import (
	"context"
	"fmt"
	"strings"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DispatchAPI is kade.dispatch.v1.DispatchService: the rider app's shift, offers and active job.
// Every request names a rider_id; empty means "the caller's rider" (x-user-id), and riders can
// only act for themselves.
type DispatchAPI struct {
	dispatchv1.UnimplementedDispatchServiceServer
	c *Core
}

func NewDispatchAPI(c *Core) *DispatchAPI { return &DispatchAPI{c: c} }

func (a *DispatchAPI) SetAvailability(ctx context.Context, req *dispatchv1.SetAvailabilityRequest) (*dispatchv1.SetAvailabilityResponse, error) {
	c := a.c
	rid, err := c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	var (
		row               *RiderRow
		available, remove bool
		pos               *commonv1.GeoPoint
		rematch           bool
	)
	err = c.inTx(ctx, func(tx pgx.Tx) error {
		now := c.Now()
		r, err := loadRider(ctx, tx, rid, true)
		if err != nil {
			return err
		}
		row = r
		if req.GetOnline() {
			if r.R.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED {
				return errRiderSuspended
			}
			pos = req.GetPosition()
			if !validPoint(pos) {
				pos = c.lastPosition(ctx, r)
			}
			if !validPoint(pos) {
				pos = homeZonePoint(r.R)
			}
			r.LastLat, r.LastLng, r.LastSeen = &pos.Lat, &pos.Lng, &now
			if r.R.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB {
				return saveRider(ctx, tx, r, false) // still on a job: stays out of the index
			}
			available = true
			return c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_ONLINE, "", now)
		}
		switch r.R.GetStatus() {
		case dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB:
			return errRiderOnJob
		case dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED, dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE:
			remove = true
			return nil
		}
		n, err := c.withdrawRiderOffer(ctx, tx, rid, now)
		if err != nil {
			return err
		}
		rematch, remove = n > 0, true
		return c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE, "", now)
	})
	if err != nil {
		return nil, err
	}
	switch {
	case available:
		if err := c.Fleet.MakeAvailable(ctx, rid, pos, c.Now()); err != nil {
			c.Log.WarnContext(ctx, "adding rider to the GEO index failed", "rider_id", rid, "err", err)
		}
		c.Wake()
	case remove:
		if err := c.Fleet.MakeUnavailable(ctx, rid); err != nil {
			c.Log.WarnContext(ctx, "removing rider from the GEO index failed", "rider_id", rid, "err", err)
		}
	}
	if rematch {
		c.Wake()
	}
	view := c.riderView(ctx, row)
	return &dispatchv1.SetAvailabilityResponse{Rider: view, CashAllowed: view.GetCashAllowed()}, nil
}

// homeZonePoint is the centre of the rider's first zone (Kollupitiya if none).
func homeZonePoint(r *dispatchv1.Rider) *commonv1.GeoPoint {
	id := "c03"
	if len(r.GetZoneIds()) > 0 {
		id = r.GetZoneIds()[0]
	}
	z, ok := ZoneByID(id)
	if !ok {
		z, _ = ZoneByID("c03")
	}
	return &commonv1.GeoPoint{Lat: z.Lat, Lng: z.Lng}
}

// withdrawRiderOffer closes the rider's open offer (going offline, suspended) and makes its
// delivery due again. Returns how many offers were withdrawn.
func (c *Core) withdrawRiderOffer(ctx context.Context, tx pgx.Tx, riderID string, now time.Time) (int, error) {
	rows, err := tx.Query(ctx, `UPDATE offers SET status = $2, decided_at = $3 WHERE rider_id::text = $1 AND status = $4 RETURNING delivery_id`,
		riderID, int16(dispatchv1.OfferStatus_OFFER_STATUS_WITHDRAWN), now, int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED))
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil || len(ids) == 0 {
		return 0, err
	}
	_, err = tx.Exec(ctx, `UPDATE deliveries SET next_attempt_at = $2 WHERE id = ANY($1) AND status IN ($3, $4)`,
		ids, now, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED))
	return len(ids), err
}

func (a *DispatchAPI) GetCurrentOffer(ctx context.Context, req *dispatchv1.GetCurrentOfferRequest) (*dispatchv1.GetCurrentOfferResponse, error) {
	rid, err := a.c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	offers, err := listOffers(ctx, a.c.Pool, `WHERE rider_id::text = $1 AND status = $2 AND expires_at > $3 ORDER BY offered_at DESC LIMIT 1`,
		rid, int16(dispatchv1.OfferStatus_OFFER_STATUS_OFFERED), a.c.Now())
	if err != nil || len(offers) == 0 {
		return &dispatchv1.GetCurrentOfferResponse{}, err
	}
	return &dispatchv1.GetCurrentOfferResponse{Offer: offers[0]}, nil
}

func (a *DispatchAPI) AcceptOffer(ctx context.Context, req *dispatchv1.AcceptOfferRequest) (*dispatchv1.AcceptOfferResponse, error) {
	c := a.c
	rid, err := c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	resp := &dispatchv1.AcceptOfferResponse{}
	var accepted bool
	err = c.inTx(ctx, func(tx pgx.Tx) error {
		key := ""
		if req.GetIdempotencyKey() != "" {
			key = rid + ":" + req.GetIdempotencyKey()
		}
		hashReq := withoutKey(req, func(r *dispatchv1.AcceptOfferRequest) { r.IdempotencyKey, r.RiderId = "", rid })
		_, err := once(ctx, tx, "AcceptOffer", key, hashReq, resp, func() error {
			d, ok, err := c.acceptOffer(ctx, tx, rid, req.GetOfferId())
			resp.Delivery, accepted = d, ok
			return err
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	if accepted {
		if err := c.Fleet.MakeUnavailable(ctx, rid); err != nil {
			c.Log.WarnContext(ctx, "removing rider from the GEO index failed", "rider_id", rid, "err", err)
		}
	}
	return resp, nil
}

// acceptOffer assigns the delivery to the rider. ok=false when the same rider had already
// accepted it (a retry without an idempotency key).
func (c *Core) acceptOffer(ctx context.Context, tx pgx.Tx, riderID, offerID string) (*dispatchv1.Delivery, bool, error) {
	now := c.Now()
	o, err := loadOffer(ctx, tx, offerID, true)
	if err != nil {
		return nil, false, err
	}
	if o.GetRiderId() != riderID {
		return nil, false, errOfferNotFound.With("offer_id", offerID)
	}
	if o.GetStatus() == dispatchv1.OfferStatus_OFFER_STATUS_ACCEPTED {
		d, err := loadDelivery(ctx, tx, "id", o.GetDeliveryId(), false)
		if err != nil {
			return nil, false, err
		}
		return d.D, false, nil
	}
	if o.GetStatus() != dispatchv1.OfferStatus_OFFER_STATUS_OFFERED || !o.GetExpiresAt().AsTime().After(now) {
		return nil, false, errOfferExpired.With("offer_id", offerID)
	}
	d, err := loadDelivery(ctx, tx, "id", o.GetDeliveryId(), true)
	if err != nil {
		return nil, false, err
	}
	if !isMatching(d.D.GetStatus()) {
		if err := setOfferStatus(ctx, tx, offerID, dispatchv1.OfferStatus_OFFER_STATUS_WITHDRAWN, "", now); err != nil {
			return nil, false, err
		}
		return nil, false, errOfferExpired.With("offer_id", offerID)
	}
	r, err := loadRider(ctx, tx, riderID, true)
	if err != nil {
		return nil, false, err
	}
	if r.R.GetStatus() == dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED {
		return nil, false, errRiderSuspended
	}
	if err := setOfferStatus(ctx, tx, offerID, dispatchv1.OfferStatus_OFFER_STATUS_ACCEPTED, "", now); err != nil {
		return nil, false, err
	}
	if err := c.assign(ctx, tx, d, r, o.GetFrom(), o.GetDelivery(), false, "", now); err != nil {
		return nil, false, err
	}
	c.Log.InfoContext(ctx, "offer accepted", "offer_id", offerID, "delivery_id", d.D.GetId(), "order_number", d.D.GetOrderNumber(), "rider_id", riderID)
	return d.D, true, nil
}

// assign gives the delivery to rider r (offer accepted or ops reassignment) and emits
// RiderAssigned and RiderStatusChanged.
func (c *Core) assign(ctx context.Context, tx pgx.Tx, d *DeliveryRow, r *RiderRow, from *commonv1.GeoPoint, preview *dispatchv1.Delivery, reassigned bool, reason string, now time.Time) error {
	if !validPoint(from) {
		from = c.lastPosition(ctx, r)
	}
	if !validPoint(from) {
		from = homeZonePoint(r.R)
	}
	toPickup := RoadKm(from, pickupPoint(d.D))
	if preview != nil && preview.GetPay() != nil {
		toPickup = preview.GetToPickupKm()
		d.D.Pay = WithTip(preview.GetPay(), d.D.GetPay().GetTip().GetAmountMinor())
		d.D.Minutes = preview.GetMinutes()
	} else {
		d.D.Pay = ComputePay(toPickup+d.D.GetTripKm(), d.D.GetPay().GetTip().GetAmountMinor(), now)
		d.D.Minutes = TravelMinutes(toPickup+d.D.GetTripKm()) + HandoverMinutes
	}
	d.D.ToPickupKm = toPickup
	d.D.RiderId = r.R.GetId()
	d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED
	d.D.AssignedAt = ts(now)
	d.D.ArrivedAtRestaurantAt, d.D.PickedUpAt, d.D.ArrivedAtCustomerAt = nil, nil, nil
	d.NextAttemptAt = nil
	d.FromLat, d.FromLng = &from.Lat, &from.Lng
	if _, err := saveDelivery(ctx, tx, d, false); err != nil {
		return err
	}
	if err := c.setRiderStatus(ctx, tx, r, dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB, "", now); err != nil {
		return err
	}
	return emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.RiderAssigned{
		DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), OrderNumber: d.D.GetOrderNumber(), RestaurantId: d.D.GetPickup().GetRestaurantId(),
		Rider: Card(r.R), ArrivesAtRestaurantAt: ts(now.Add(time.Duration(TravelMinutes(toPickup)) * time.Minute)),
		Reassigned: reassigned, Reason: reason, OccurredAt: ts(now),
	})
}

func (a *DispatchAPI) DeclineOffer(ctx context.Context, req *dispatchv1.DeclineOfferRequest) (*dispatchv1.DeclineOfferResponse, error) {
	c := a.c
	rid, err := c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	err = c.inTx(ctx, func(tx pgx.Tx) error {
		now := c.Now()
		o, err := loadOffer(ctx, tx, req.GetOfferId(), true)
		if err != nil {
			return err
		}
		if o.GetRiderId() != rid {
			return errOfferNotFound.With("offer_id", req.GetOfferId())
		}
		if o.GetStatus() != dispatchv1.OfferStatus_OFFER_STATUS_OFFERED {
			return nil // already expired/withdrawn: declining is a no-op
		}
		reason := strings.TrimSpace(req.GetReason())
		if err := setOfferStatus(ctx, tx, o.GetId(), dispatchv1.OfferStatus_OFFER_STATUS_DECLINED, reason, now); err != nil {
			return err
		}
		d, err := loadDelivery(ctx, tx, "id", o.GetDeliveryId(), true)
		if err != nil {
			return err
		}
		if isMatching(d.D.GetStatus()) {
			d.NextAttemptAt = &now
			if _, err := saveDelivery(ctx, tx, d, false); err != nil {
				return err
			}
		}
		return emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.DeliveryOfferDeclined{
			DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), OfferId: o.GetId(), RiderId: rid, Reason: reason, OccurredAt: ts(now),
		})
	})
	if err != nil {
		return nil, err
	}
	c.Wake()
	return &dispatchv1.DeclineOfferResponse{}, nil
}

var activeStatuses = []int16{
	int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT),
	int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP), int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER),
}

func (a *DispatchAPI) GetActiveJob(ctx context.Context, req *dispatchv1.GetActiveJobRequest) (*dispatchv1.GetActiveJobResponse, error) {
	rid, err := a.c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	ds, err := listDeliveries(ctx, a.c.Pool, `WHERE rider_id::text = $1 AND status = ANY($2) ORDER BY assigned_at DESC LIMIT 1`, rid, activeStatuses)
	if err != nil || len(ds) == 0 {
		return &dispatchv1.GetActiveJobResponse{}, err
	}
	return &dispatchv1.GetActiveJobResponse{Delivery: ds[0].D}, nil
}

// step runs one job step for the rider's own delivery in a transaction, under an optional
// idempotency key. fn changes d (and saves/emits); it may return an after-commit action.
func (c *Core) step(ctx context.Context, riderID, deliveryID, scope, idemKey string, hashReq, resp proto.Message,
	fn func(tx pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error)) error {
	rid, err := c.resolveRider(ctx, riderID)
	if err != nil {
		return err
	}
	var after func(context.Context)
	err = c.inTx(ctx, func(tx pgx.Tx) error {
		key := ""
		if idemKey != "" {
			key = rid + ":" + idemKey
		}
		_, err := once(ctx, tx, scope, key, hashReq, resp, func() error {
			d, err := loadDelivery(ctx, tx, "id", deliveryID, true)
			if err != nil {
				return err
			}
			if d.D.GetRiderId() != rid {
				if d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED {
					return errDeliveryCancelled
				}
				return errNotYourDelivery
			}
			if d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED {
				return errDeliveryCancelled
			}
			after, err = fn(tx, d, c.Now())
			return err
		})
		return err
	})
	if err == nil && after != nil {
		after(ctx)
	}
	return err
}

func (a *DispatchAPI) ArriveAtRestaurant(ctx context.Context, req *dispatchv1.ArriveAtRestaurantRequest) (*dispatchv1.ArriveAtRestaurantResponse, error) {
	resp := &dispatchv1.ArriveAtRestaurantResponse{}
	hashReq := withoutKey(req, func(r *dispatchv1.ArriveAtRestaurantRequest) { r.IdempotencyKey = "" })
	err := a.c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "ArriveAtRestaurant", req.GetIdempotencyKey(), hashReq, resp,
		func(tx pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error) {
			if d.D.GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED {
				d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT
				d.D.ArrivedAtRestaurantAt = ts(now)
				if _, err := saveDelivery(ctx, tx, d, false); err != nil {
					return nil, err
				}
				if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.RiderArrivedAtRestaurant{
					DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), RestaurantId: d.D.GetPickup().GetRestaurantId(),
					RiderId: d.D.GetRiderId(), OccurredAt: ts(now),
				}); err != nil {
					return nil, err
				}
			}
			resp.Delivery = d.D
			return nil, nil
		})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// NotReadyDefault is the kitchen estimate when it gave none.
const NotReadyDefault = 3 * time.Minute

// ReadyAt is when the food should be ready: now if the kitchen marked it ready, else the
// kitchen's ready_by if still ahead, else a few minutes from now.
func ReadyAt(d *DeliveryRow, now time.Time) time.Time {
	if d.FoodReadyAt != nil {
		return now
	}
	if rb := d.D.GetReadyBy(); rb != nil && rb.IsValid() && rb.AsTime().After(now) {
		return rb.AsTime()
	}
	return now.Add(NotReadyDefault)
}

func (a *DispatchAPI) ReportFoodNotReady(ctx context.Context, req *dispatchv1.ReportFoodNotReadyRequest) (*dispatchv1.ReportFoodNotReadyResponse, error) {
	var readyAt time.Time
	err := a.c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "", "", req, &dispatchv1.ReportFoodNotReadyResponse{},
		func(_ pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error) {
			readyAt = ReadyAt(d, now)
			return nil, nil
		})
	if err != nil {
		return nil, err
	}
	return &dispatchv1.ReportFoodNotReadyResponse{ReadyAt: timestamppb.New(readyAt)}, nil
}

// CheckPickup enforces the checklist: every item ticked, or the bag sealed.
func CheckPickup(items []*dispatchv1.DeliveryItem, checked []string, sealed bool) error {
	if sealed {
		return nil
	}
	ticked := map[string]bool{}
	for _, id := range checked {
		ticked[id] = true
	}
	for _, it := range items {
		if !ticked[it.GetId()] {
			return errItemsNotChecked.With("item_id", it.GetId())
		}
	}
	return nil
}

func (a *DispatchAPI) ConfirmPickup(ctx context.Context, req *dispatchv1.ConfirmPickupRequest) (*dispatchv1.ConfirmPickupResponse, error) {
	resp := &dispatchv1.ConfirmPickupResponse{}
	hashReq := withoutKey(req, func(r *dispatchv1.ConfirmPickupRequest) { r.IdempotencyKey = "" })
	err := a.c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "ConfirmPickup", req.GetIdempotencyKey(), hashReq, resp,
		func(tx pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error) {
			switch d.D.GetStatus() {
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED, dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
				if err := CheckPickup(d.D.GetItems(), req.GetCheckedItemIds(), req.GetSealed() || d.D.GetSealed()); err != nil {
					return nil, err
				}
				if d.D.GetArrivedAtRestaurantAt() == nil {
					d.D.ArrivedAtRestaurantAt = ts(now)
				}
				d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP
				d.D.PickedUpAt = ts(now)
				d.D.Sealed = req.GetSealed() || d.D.GetSealed()
				if _, err := saveDelivery(ctx, tx, d, false); err != nil {
					return nil, err
				}
				if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.DeliveryPickedUp{
					DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), RestaurantId: d.D.GetPickup().GetRestaurantId(),
					RiderId: d.D.GetRiderId(), Sealed: d.D.GetSealed(), OccurredAt: ts(now),
				}); err != nil {
					return nil, err
				}
			}
			resp.Delivery = d.D
			return nil, nil
		})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (a *DispatchAPI) ArriveAtCustomer(ctx context.Context, req *dispatchv1.ArriveAtCustomerRequest) (*dispatchv1.ArriveAtCustomerResponse, error) {
	resp := &dispatchv1.ArriveAtCustomerResponse{}
	hashReq := withoutKey(req, func(r *dispatchv1.ArriveAtCustomerRequest) { r.IdempotencyKey = "" })
	err := a.c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "ArriveAtCustomer", req.GetIdempotencyKey(), hashReq, resp,
		func(tx pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error) {
			switch d.D.GetStatus() {
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED, dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
				return nil, errNotPickedUp
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP:
				d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER
				d.D.ArrivedAtCustomerAt = ts(now)
				if _, err := saveDelivery(ctx, tx, d, false); err != nil {
					return nil, err
				}
				if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.RiderArrivedAtCustomer{
					DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), RiderId: d.D.GetRiderId(), OccurredAt: ts(now),
				}); err != nil {
					return nil, err
				}
			}
			resp.Delivery = d.D
			return nil, nil
		})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// CheckCompletion validates proof of delivery and the cash taken at the door.
func CheckCompletion(d *DeliveryRow, req *dispatchv1.CompleteDeliveryRequest) error {
	switch req.GetProof() {
	case dispatchv1.ProofKind_PROOF_KIND_CODE:
		code := strings.TrimSpace(req.GetCode())
		if code == "" || (d.Code != "" && code != d.Code) {
			return errCodeMismatch
		}
	case dispatchv1.ProofKind_PROOF_KIND_PHOTO:
		if strings.TrimSpace(req.GetPhotoRef()) == "" {
			return errPhotoRequired
		}
	default:
		return errProofRequired
	}
	if d.D.GetPayment() == commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH &&
		req.GetCashCollected().GetAmountMinor() < d.D.GetCashToCollect().GetAmountMinor() {
		return errCashShort.With("cash_to_collect_minor", fmt.Sprint(d.D.GetCashToCollect().GetAmountMinor()))
	}
	return nil
}

func (a *DispatchAPI) CompleteDelivery(ctx context.Context, req *dispatchv1.CompleteDeliveryRequest) (*dispatchv1.CompleteDeliveryResponse, error) {
	c := a.c
	resp := &dispatchv1.CompleteDeliveryResponse{}
	hashReq := withoutKey(req, func(r *dispatchv1.CompleteDeliveryRequest) { r.IdempotencyKey = "" })
	err := c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "CompleteDelivery", req.GetIdempotencyKey(), hashReq, resp,
		func(tx pgx.Tx, d *DeliveryRow, now time.Time) (func(context.Context), error) {
			switch d.D.GetStatus() {
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED:
				resp.Trip = TripOf(d)
				return nil, nil
			case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP, dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
			default:
				return nil, errNotPickedUp
			}
			if err := CheckCompletion(d, req); err != nil {
				return nil, err
			}
			if d.D.GetArrivedAtCustomerAt() == nil {
				d.D.ArrivedAtCustomerAt = ts(now)
			}
			d.D.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED
			d.D.DeliveredAt = ts(now)
			d.D.Proof = req.GetProof()
			d.D.ProofPhotoRef = req.GetPhotoRef()
			d.D.CashCollected = lkr(0)
			if d.D.GetPayment() == commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH {
				d.D.CashCollected = lkr(req.GetCashCollected().GetAmountMinor())
			}
			if _, err := saveDelivery(ctx, tx, d, false); err != nil {
				return nil, err
			}
			if err := emitDelivery(ctx, tx, d.D.GetId(), &dispatchv1.DeliveryCompleted{
				DeliveryId: d.D.GetId(), OrderId: d.D.GetOrderId(), OrderNumber: d.D.GetOrderNumber(), RiderId: d.D.GetRiderId(),
				Delivery: d.D, Proof: d.D.GetProof(), CashCollected: d.D.GetCashCollected(), Pay: d.D.GetPay(),
				Km: round1(d.D.GetToPickupKm() + d.D.GetTripKm()), ZoneId: d.D.GetZoneId(), OccurredAt: ts(now),
			}); err != nil {
				return nil, err
			}
			if err := c.freeRider(ctx, tx, d.D.GetRiderId(), now); err != nil {
				return nil, err
			}
			resp.Trip = TripOf(d)
			c.Log.InfoContext(ctx, "delivered", "delivery_id", d.D.GetId(), "order_number", d.D.GetOrderNumber(), "rider_id", d.D.GetRiderId())
			riderID, drop := d.D.GetRiderId(), d.D.GetDropoff().GetLocation()
			return func(ctx context.Context) {
				r, err := loadRider(ctx, c.Pool, riderID, false)
				if err != nil || r.R.GetStatus() != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE {
					return
				}
				p := drop
				if !validPoint(p) {
					p = c.lastPosition(ctx, r)
				}
				if p != nil {
					_ = c.Fleet.MakeAvailable(ctx, riderID, p, c.Now())
				}
			}, nil
		})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// TripOf is a delivered delivery as the rider's history shows it.
func TripOf(d *DeliveryRow) *dispatchv1.Trip {
	t := &dispatchv1.Trip{
		Id: d.D.GetId(), OrderNumber: d.D.GetOrderNumber(), RestaurantName: d.D.GetPickup().GetName(),
		PickupArea: d.D.GetPickup().GetArea(), DropoffArea: d.D.GetDropoff().GetArea(), CustomerFirstName: d.D.GetDropoff().GetFirstName(),
		Km: round1(d.D.GetToPickupKm() + d.D.GetTripKm()), Pay: d.D.GetPay(), Payment: d.D.GetPayment(), CashCollected: d.D.GetCashCollected(),
		AcceptedAt: d.D.GetAssignedAt(), ArrivedAtRestaurantAt: d.D.GetArrivedAtRestaurantAt(), PickedUpAt: d.D.GetPickedUpAt(),
		DeliveredAt: d.D.GetDeliveredAt(), Proof: d.D.GetProof(), CustomerRating: d.CustomerRating,
		PickupPoint: d.D.GetPickup().GetLocation(), DropoffPoint: d.D.GetDropoff().GetLocation(),
	}
	if t.CashCollected == nil {
		t.CashCollected = lkr(0)
	}
	if d.FromLat != nil && d.FromLng != nil {
		t.From = &commonv1.GeoPoint{Lat: *d.FromLat, Lng: *d.FromLng}
	}
	return t
}

func (a *DispatchAPI) SendCustomerMessage(ctx context.Context, req *dispatchv1.SendCustomerMessageRequest) (*dispatchv1.SendCustomerMessageResponse, error) {
	c := a.c
	text := strings.TrimSpace(req.GetText())
	if text == "" {
		return nil, errMessageRequired
	}
	var d *DeliveryRow
	id, _ := uuid.NewV7()
	err := c.step(ctx, req.GetRiderId(), req.GetDeliveryId(), "", "", req, &dispatchv1.SendCustomerMessageResponse{},
		func(tx pgx.Tx, row *DeliveryRow, now time.Time) (func(context.Context), error) {
			d = row
			_, err := tx.Exec(ctx, `INSERT INTO customer_messages (id, delivery_id, rider_id, text, sent_at) VALUES ($1, $2, $3, $4, $5)`,
				id, row.D.GetId(), row.D.GetRiderId(), text, now)
			return nil, err
		})
	if err != nil {
		return nil, err
	}
	if c.Messenger != nil {
		r, _ := loadRider(ctx, c.Pool, d.D.GetRiderId(), false)
		first := ""
		if r != nil {
			first = r.R.GetFirstName()
		}
		go func() { // best effort, never delays the rider
			mctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			if err := c.Messenger(mctx, d, first, text, id.String()); err != nil {
				c.Log.WarnContext(mctx, "customer message not sent", "delivery_id", d.D.GetId(), "err", err)
			}
		}()
	}
	return &dispatchv1.SendCustomerMessageResponse{}, nil
}

func (a *DispatchAPI) ListTrips(ctx context.Context, req *dispatchv1.ListTripsRequest) (*dispatchv1.ListTripsResponse, error) {
	c := a.c
	rid, err := c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	from, to := time.Unix(0, 0), c.Now().Add(24*time.Hour)
	if req.GetFrom() != nil {
		from = req.GetFrom().AsTime()
	}
	if req.GetTo() != nil {
		to = req.GetTo().AsTime()
	}
	size, offset := clampPage(req.GetPage().GetPageSize(), 50, 200), pageOffset(req.GetPage().GetPageToken())
	where := `WHERE rider_id::text = $1 AND status = $2 AND delivered_at >= $3 AND delivered_at < $4`
	args := []any{rid, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED), from, to}
	var total int32
	if err := c.Pool.QueryRow(ctx, `SELECT count(*) FROM deliveries `+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	ds, err := listDeliveries(ctx, c.Pool, where+fmt.Sprintf(` ORDER BY delivered_at DESC LIMIT %d OFFSET %d`, size, offset), args...)
	if err != nil {
		return nil, err
	}
	resp := &dispatchv1.ListTripsResponse{Page: &commonv1.PageResponse{TotalSize: total}}
	for _, d := range ds {
		resp.Trips = append(resp.Trips, TripOf(d))
	}
	if offset+len(ds) < int(total) {
		resp.Page.NextPageToken = fmt.Sprint(offset + len(ds))
	}
	return resp, nil
}

func (a *DispatchAPI) GetTrip(ctx context.Context, req *dispatchv1.GetTripRequest) (*dispatchv1.GetTripResponse, error) {
	rid, err := a.c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	ds, err := listDeliveries(ctx, a.c.Pool, `WHERE id::text = $1 AND rider_id::text = $2 AND status = $3`,
		req.GetTripId(), rid, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED))
	if err != nil {
		return nil, err
	}
	if len(ds) == 0 {
		return nil, errTripNotFound.With("trip_id", req.GetTripId())
	}
	return &dispatchv1.GetTripResponse{Trip: TripOf(ds[0])}, nil
}

func (a *DispatchAPI) ListQuests(ctx context.Context, req *dispatchv1.ListQuestsRequest) (*dispatchv1.ListQuestsResponse, error) {
	c := a.c
	rid, err := c.resolveRider(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	now := c.Now()
	rows, err := c.Pool.Query(ctx, `SELECT COALESCE(assigned_at, delivered_at) FROM deliveries
	  WHERE rider_id::text = $1 AND status = $2 AND delivered_at >= $3`,
		rid, int16(dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED), WeekStart(now))
	if err != nil {
		return nil, err
	}
	accepted, err := pgx.CollectRows(rows, pgx.RowTo[time.Time])
	if err != nil {
		return nil, err
	}
	return &dispatchv1.ListQuestsResponse{Quests: Quests(now, accepted)}, nil
}

// Quests are the rider app's three running bonuses, computed from this week's trips (accepted
// times): 12 trips today (Rs 800), the lunch rush boost (4 trips 12–2 pm, Rs 240) and the weekly
// streak (70 trips, Rs 2,500).
func Quests(now time.Time, acceptedThisWeek []time.Time) []*dispatchv1.Quest {
	today := DayStart(now)
	var todayN, lunchN int32
	for _, t := range acceptedThisWeek {
		if t.Before(today) {
			continue
		}
		todayN++
		if h := t.In(Colombo).Hour(); h >= 12 && h < 14 {
			lunchN++
		}
	}
	weekN := int32(len(acceptedThisWeek))
	title := fmt.Sprintf("Complete %d more trips by 10 pm", 12-min(todayN, 12))
	if todayN >= 12 {
		title = "12 trips done today"
	}
	return []*dispatchv1.Quest{
		{Id: "q-today", Title: title, Detail: "Rs 800 bonus for 12 trips today", Done: min(todayN, 12), Target: 12,
			Bonus: lkr(80000), EndsAt: ts(today.Add(22 * time.Hour))},
		{Id: "q-lunch", Title: "Lunch rush boost", Detail: "Rs 60 extra on every trip from 12 to 2 pm in Kollupitiya and Bambalapitiya",
			Done: min(lunchN, 4), Target: 4, Bonus: lkr(24000), EndsAt: ts(today.Add(14 * time.Hour))},
		{Id: "q-week", Title: "Weekly streak", Detail: "Rs 2,500 bonus for 70 trips this week", Done: min(weekN, 70), Target: 70,
			Bonus: lkr(250000), EndsAt: ts(WeekStart(now).AddDate(0, 0, 7))},
	}
}
