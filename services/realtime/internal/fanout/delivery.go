package fanout

import (
	"context"
	"fmt"

	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	merchantv1 "github.com/UvinduPathirana/kade/gen/go/kade/merchant/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
)

func (s *Service) registerMerchant(r *kafka.Router) {
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *merchantv1.TicketAccepted) error {
		at := s.ts(e.GetOccurredAt())
		return s.patchTicket(ctx, d, at, orderRef{e.GetOrderId(), e.GetOrderNumber(), "", e.GetOutletId()}, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_PREPARING)
			setTime(&t.AcceptedAt, at)
			setTime(&t.ReadyBy, e.GetReadyBy())
			if e.GetPrepMinutes() > 0 {
				t.PrepMinutes = e.GetPrepMinutes()
			}
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *merchantv1.TicketRejected) error {
		at := s.ts(e.GetOccurredAt())
		return s.patchTicket(ctx, d, at, orderRef{e.GetOrderId(), e.GetOrderNumber(), "", e.GetOutletId()}, false, func(t *merchantv1.Ticket) {
			st := merchantv1.TicketStatus_TICKET_STATUS_REJECTED
			if e.GetReason() == orderv1.RejectionReason_REJECTION_REASON_TIMEOUT {
				st = merchantv1.TicketStatus_TICKET_STATUS_MISSED
			}
			setTicketStatus(t, st)
			t.RejectReason, t.RejectNote = e.GetReason(), e.GetNote()
			setTime(&t.ClosedAt, at)
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *merchantv1.TicketReady) error {
		at := s.ts(e.GetOccurredAt())
		return s.patchTicket(ctx, d, at, orderRef{e.GetOrderId(), e.GetOrderNumber(), "", e.GetOutletId()}, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_READY)
			setTime(&t.ReadyAt, at)
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *merchantv1.TicketHandedOver) error {
		at := s.ts(e.GetOccurredAt())
		return s.patchTicket(ctx, d, at, orderRef{e.GetOrderId(), e.GetOrderNumber(), "", e.GetOutletId()}, false, func(t *merchantv1.Ticket) {
			setTicketStatus(t, merchantv1.TicketStatus_TICKET_STATUS_PICKED_UP)
			setTime(&t.PickedUpAt, at)
			setTime(&t.ClosedAt, at)
		})
	})
}

func (s *Service) registerDelivery(r *kafka.Router) {
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryRequested) error {
		if _, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			mergeDelivery(v, e.GetDelivery())
			setDeliveryStatus(v, dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING)
		}); err != nil {
			return err
		}
		return s.v.OpsWaiting(ctx, e.GetDeliveryId(), true)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryOfferSent) error {
		offer := e.GetOffer()
		rider := offer.GetRiderId()
		if rider == "" {
			return nil
		}
		if _, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			if v.GetPickup() == nil {
				mergeDelivery(v, offer.GetDelivery())
				v.RiderId = ""
			}
		}); err != nil {
			return err
		}
		if err := s.v.SetOpenOffer(ctx, rider, offer.GetId(), e.GetDeliveryId(), s.o.OfferTTL); err != nil {
			return err
		}
		return s.emit(ctx, d, s.ts(e.GetOccurredAt()), offerFrame(offer), channel.Rider(rider))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryOfferDeclined) error {
		return s.withdrawOffer(ctx, d, s.ts(e.GetOccurredAt()), e.GetRiderId(), e.GetOfferId(), e.GetDeliveryId())
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryOfferExpired) error {
		return s.withdrawOffer(ctx, d, s.ts(e.GetOccurredAt()), e.GetRiderId(), e.GetOfferId(), e.GetDeliveryId())
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.RiderAssigned) error {
		at := s.ts(e.GetOccurredAt())
		card := e.GetRider()
		rider := card.GetRiderId()
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			v.RiderId = rider
			if v.OrderNumber == "" {
				v.OrderNumber = e.GetOrderNumber()
			}
			setDeliveryStatus(v, dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED)
			setTime(&v.AssignedAt, at)
		})
		if err != nil {
			return err
		}
		if err := s.v.SetOrderRider(ctx, e.GetOrderId(), rider); err != nil {
			return err
		}
		ref := orderRef{e.GetOrderId(), e.GetOrderNumber(), "", e.GetRestaurantId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			o.Rider = orderRider(card)
			o.DeliveryId = e.GetDeliveryId()
		}); err != nil {
			return err
		}
		if err := s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) {
			t.Rider = ticketRider(orderRider(card))
			t.RiderAtCounter = false
			setTime(&t.RiderArrivesAt, e.GetArrivesAtRestaurantAt())
		}); err != nil {
			return err
		}
		// Another rider still looking at an offer for this job loses it.
		if holder, err := s.v.OfferHolder(ctx, e.GetDeliveryId()); err != nil {
			return err
		} else if holder != "" && holder != rider {
			if err := s.withdrawOffer(ctx, d, at, holder, "", e.GetDeliveryId()); err != nil {
				return err
			}
		}
		if err := s.v.ClearOpenOffer(ctx, rider, e.GetDeliveryId()); err != nil {
			return err
		}
		notice := ""
		if e.GetReassigned() {
			notice = "Job assigned by Kadé support"
		}
		if err := s.emit(ctx, d, at, jobFrame(v, notice), channel.Rider(rider)); err != nil {
			return err
		}
		if err := s.v.OpsWaiting(ctx, e.GetDeliveryId(), false); err != nil {
			return err
		}
		return s.v.OpsClearAttention(ctx, unmatchedID(e.GetDeliveryId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.RiderUnassigned) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			if v.RiderId == e.GetRiderId() || v.RiderId == "" {
				v.RiderId = ""
				v.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING // back to matching (explicitly backwards)
			}
		})
		if err != nil {
			return err
		}
		acc, _, err := s.v.OrderAccess(ctx, e.GetOrderId())
		if err != nil {
			return err
		}
		if acc.RiderID == e.GetRiderId() {
			if err := s.v.SetOrderRider(ctx, e.GetOrderId(), ""); err != nil {
				return err
			}
		}
		ref := orderRef{id: e.GetOrderId()}
		if _, err := s.patchOrder(ctx, d, at, ref, func(o *orderv1.Order) {
			if o.GetRider().GetRiderId() == e.GetRiderId() {
				o.Rider = nil
			}
		}); err != nil {
			return err
		}
		if err := s.patchTicket(ctx, d, at, ref, false, func(t *merchantv1.Ticket) {
			if t.GetRider().GetRiderId() == e.GetRiderId() {
				t.Rider, t.RiderArrivesAt, t.RiderAtCounter = nil, nil, false
			}
		}); err != nil {
			return err
		}
		// The old rider's job goes away: the delivery no longer names them.
		old := proto.Clone(v).(*dispatchv1.Delivery)
		old.RiderId = ""
		if err := s.emit(ctx, d, at, jobFrame(old, "Job reassigned"), channel.Rider(e.GetRiderId())); err != nil {
			return err
		}
		return s.v.OpsWaiting(ctx, e.GetDeliveryId(), true)
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.RiderArrivedAtRestaurant) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			setDeliveryStatus(v, dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT)
			setTime(&v.ArrivedAtRestaurantAt, at)
		})
		if err != nil {
			return err
		}
		if err := s.patchTicket(ctx, d, at, orderRef{id: e.GetOrderId(), restaurantID: e.GetRestaurantId()}, false, func(t *merchantv1.Ticket) {
			t.RiderAtCounter = true
			setTime(&t.RiderArrivesAt, at)
		}); err != nil {
			return err
		}
		return s.emit(ctx, d, at, jobFrame(v, ""), channel.Rider(e.GetRiderId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryPickedUp) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			setDeliveryStatus(v, dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP)
			setTime(&v.PickedUpAt, at)
			v.Sealed = v.Sealed || e.GetSealed()
		})
		if err != nil {
			return err
		}
		return s.emit(ctx, d, at, jobFrame(v, ""), channel.Rider(e.GetRiderId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.RiderArrivedAtCustomer) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			setDeliveryStatus(v, dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER)
			setTime(&v.ArrivedAtCustomerAt, at)
		})
		if err != nil {
			return err
		}
		return s.emit(ctx, d, at, jobFrame(v, ""), channel.Rider(e.GetRiderId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryCompleted) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			mergeDelivery(v, e.GetDelivery())
			v.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED
			setTime(&v.DeliveredAt, at)
		})
		if err != nil {
			return err
		}
		if err := s.emit(ctx, d, at, jobFrame(v, "Delivered"), channel.Rider(e.GetRiderId())); err != nil {
			return err
		}
		if err := s.v.OpsWaiting(ctx, e.GetDeliveryId(), false); err != nil {
			return err
		}
		return s.v.OpsClearAttention(ctx, unmatchedID(e.GetDeliveryId()))
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryMatchingFailed) error {
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			if v.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED && v.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED {
				v.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED
			}
			v.Attempts = e.GetAttempts()
		})
		if err != nil {
			return err
		}
		label := v.GetOrderNumber()
		if label == "" {
			label = "an order"
		}
		return s.v.OpsAttention(ctx, &dispatchv1.AttentionItem{
			Id:         unmatchedID(e.GetDeliveryId()),
			Kind:       dispatchv1.AttentionKind_ATTENTION_KIND_UNMATCHED_DELIVERY,
			Title:      "No rider for " + label,
			Detail:     fmt.Sprintf("No rider accepted after %d matching rounds.", e.GetAttempts()),
			Severity:   3,
			RecordType: "order",
			RecordId:   e.GetOrderId(),
		})
	})
	kafka.Handle(r, func(ctx context.Context, d *kafka.Delivery, e *dispatchv1.DeliveryCancelled) error {
		at := s.ts(e.GetOccurredAt())
		v, err := s.patchDelivery(ctx, e.GetDeliveryId(), e.GetOrderId(), func(v *dispatchv1.Delivery) {
			v.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED
		})
		if err != nil {
			return err
		}
		if e.GetRiderId() != "" {
			if err := s.emit(ctx, d, at, jobFrame(v, "Order cancelled"), channel.Rider(e.GetRiderId())); err != nil {
				return err
			}
		}
		if holder, err := s.v.OfferHolder(ctx, e.GetDeliveryId()); err != nil {
			return err
		} else if holder != "" {
			if err := s.withdrawOffer(ctx, d, at, holder, "", e.GetDeliveryId()); err != nil {
				return err
			}
		}
		if err := s.v.OpsWaiting(ctx, e.GetDeliveryId(), false); err != nil {
			return err
		}
		return s.v.OpsClearAttention(ctx, unmatchedID(e.GetDeliveryId()))
	})
}

// patchDelivery updates the delivery view (creating it when unseen) and links order → delivery.
func (s *Service) patchDelivery(ctx context.Context, deliveryID, orderID string, fn func(v *dispatchv1.Delivery)) (*dispatchv1.Delivery, error) {
	if deliveryID == "" {
		return &dispatchv1.Delivery{OrderId: orderID}, nil
	}
	v, _, err := s.v.UpdateDelivery(ctx, deliveryID, func(v *dispatchv1.Delivery, _ bool) bool {
		fn(v)
		v.Id = deliveryID
		if v.OrderId == "" {
			v.OrderId = orderID
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	if orderID != "" {
		if err := s.v.SetOrderDelivery(ctx, orderID, deliveryID); err != nil {
			return nil, err
		}
	}
	return v, nil
}

// withdrawOffer tells a rider their open offer is gone (offerID "" = whatever offer they hold for
// deliveryID). A newer offer on the rider's screen is left alone.
func (s *Service) withdrawOffer(ctx context.Context, d *kafka.Delivery, at *timestamppb.Timestamp, rider, offerID, deliveryID string) error {
	if rider == "" {
		return nil
	}
	cur, curDelivery, err := s.v.OpenOffer(ctx, rider)
	if err != nil {
		return err
	}
	if cur != "" && ((offerID != "" && cur != offerID) || (offerID == "" && curDelivery != deliveryID)) {
		return nil
	}
	if err := s.v.ClearOpenOffer(ctx, rider, deliveryID); err != nil {
		return err
	}
	return s.emit(ctx, d, at, offerFrame(nil), channel.Rider(rider))
}

// riderNotice pushes the current job with a notice to the order's assigned rider, if any.
func (s *Service) riderNotice(ctx context.Context, d *kafka.Delivery, at *timestamppb.Timestamp, orderID, deliveryID, notice string) error {
	if deliveryID == "" {
		var err error
		if deliveryID, err = s.v.OrderDelivery(ctx, orderID); err != nil || deliveryID == "" {
			return err
		}
	}
	v, ok, err := s.v.Delivery(ctx, deliveryID)
	if err != nil || !ok || v.GetRiderId() == "" {
		return err
	}
	return s.emit(ctx, d, at, jobFrame(v, notice), channel.Rider(v.GetRiderId()))
}

func offerFrame(offer *dispatchv1.DeliveryOffer) frame {
	return frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
		m.Payload = &realtimev1.RealtimeMessage_RiderOffer{RiderOffer: &realtimev1.RiderOfferUpdate{Offer: offer}}
	}}
}

func jobFrame(v *dispatchv1.Delivery, notice string) frame {
	return frame{replay: true, set: func(m *realtimev1.RealtimeMessage) {
		m.Payload = &realtimev1.RealtimeMessage_RiderJob{RiderJob: &realtimev1.RiderJobUpdate{Delivery: v, Notice: notice}}
	}}
}

func unmatchedID(deliveryID string) string { return "unmatched:" + deliveryID }

func orderRider(c *dispatchv1.RiderCard) *orderv1.OrderRider {
	if c == nil {
		return nil
	}
	return &orderv1.OrderRider{RiderId: c.GetRiderId(), Name: c.GetName(), FirstName: c.GetFirstName(), Rating: c.GetRating(),
		Vehicle: c.GetVehicle(), Plate: c.GetPlate(), MaskedPhone: c.GetMaskedPhone(), Phone: c.GetPhone()}
}

// mergeDelivery overlays a full Delivery from an event, keeping progress the view already has.
func mergeDelivery(v *dispatchv1.Delivery, full *dispatchv1.Delivery) {
	if full == nil {
		return
	}
	status, rider := v.GetStatus(), v.GetRiderId()
	proto.Merge(v, full)
	if deliveryRank(status) > deliveryRank(full.GetStatus()) {
		v.Status = status
	}
	if v.RiderId == "" {
		v.RiderId = rider
	}
}

func deliveryRank(s dispatchv1.DeliveryStatus) int {
	switch s {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING, dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED:
		return 1
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED:
		return 2
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT:
		return 3
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP:
		return 4
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
		return 5
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED, dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED:
		return rankFinal
	}
	return 0
}

func setDeliveryStatus(v *dispatchv1.Delivery, st dispatchv1.DeliveryStatus) {
	if deliveryRank(st) >= deliveryRank(v.GetStatus()) && deliveryRank(v.GetStatus()) < rankFinal {
		v.Status = st
	}
}
