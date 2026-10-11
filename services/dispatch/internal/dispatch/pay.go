package dispatch

import (
	"math"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
)

// Rider pay, in LKR minor units. Matches the rider app's offers: Rs 180 base, about Rs 50 per km
// ridden (to the restaurant and on to the customer, rounded to Rs 10), the customer's card tip, and
// a Rs 50 boost on trips accepted in the lunch (12–2 pm) and dinner (7–9:30 pm) peaks.
const (
	PayBaseMinor      = 18000
	PayPerKmMinor     = 5000
	PayPeakBoostMinor = 5000
)

func lkr(minor int64) *commonv1.Money { return &commonv1.Money{AmountMinor: minor, Currency: "LKR"} }

// IsPeak reports whether t falls in a lunch or dinner peak, Colombo time.
func IsPeak(t time.Time) bool {
	m := t.In(Colombo).Hour()*60 + t.In(Colombo).Minute()
	return (m >= 12*60 && m < 14*60) || (m >= 19*60 && m < 21*60+30)
}

// ComputePay prices a trip of km kilometres (pickup + drop-off legs) accepted at `at`.
func ComputePay(km float64, tipMinor int64, at time.Time) *dispatchv1.RiderPay {
	distance := int64(math.Round(km*PayPerKmMinor/1000)) * 1000 // round to Rs 10
	var boost int64
	if IsPeak(at) {
		boost = PayPeakBoostMinor
	}
	return payOf(PayBaseMinor, distance, tipMinor, boost)
}

func payOf(base, distance, tip, boost int64) *dispatchv1.RiderPay {
	return &dispatchv1.RiderPay{Base: lkr(base), Distance: lkr(distance), Tip: lkr(tip), Boost: lkr(boost), Total: lkr(base + distance + tip + boost)}
}

// WithTip returns pay with the tip replaced and the total recomputed.
func WithTip(p *dispatchv1.RiderPay, tipMinor int64) *dispatchv1.RiderPay {
	return payOf(p.GetBase().GetAmountMinor(), p.GetDistance().GetAmountMinor(), tipMinor, p.GetBoost().GetAmountMinor())
}

// Compensation is what a rider earns when the order is cancelled under them: nothing before they
// set off, half the base on the way, base plus the pickup leg once at the restaurant.
func Compensation(d *dispatchv1.Delivery) *dispatchv1.RiderPay {
	switch d.GetStatus() {
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED:
		return payOf(PayBaseMinor/2, 0, 0, 0)
	case dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT, dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP,
		dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_CUSTOMER:
		return payOf(PayBaseMinor, int64(math.Round(d.GetToPickupKm()*PayPerKmMinor/1000))*1000, 0, 0)
	}
	return payOf(0, 0, 0, 0)
}
