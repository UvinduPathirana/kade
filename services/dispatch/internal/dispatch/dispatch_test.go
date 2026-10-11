package dispatch

import (
	"context"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/auth"
)

// 2026-10-12 10:30 in Colombo (a Monday).
var t0 = time.Date(2026, 10, 12, 10, 30, 0, 0, Colombo)

func reason(err error) string {
	if ae, ok := err.(*apperr.Error); ok {
		return ae.Reason
	}
	return ""
}

func TestComputePayMatchesTheRiderApp(t *testing.T) {
	// Offer KD-4817: 1.1 + 3.4 km → Rs 180 base + Rs 230 distance; no peak at 10:30.
	p := ComputePay(4.5, 0, t0)
	if p.Base.AmountMinor != 18000 || p.Distance.AmountMinor != 23000 || p.Boost.AmountMinor != 0 || p.Total.AmountMinor != 41000 {
		t.Fatalf("pay = %v", p)
	}
	lunch := ComputePay(3.7, 10000, time.Date(2026, 10, 12, 12, 30, 0, 0, Colombo))
	if lunch.Boost.AmountMinor != 5000 || lunch.Tip.AmountMinor != 10000 || lunch.Total.AmountMinor != 18000+19000+10000+5000 {
		t.Fatalf("lunch pay = %v", lunch)
	}
	if !IsPeak(time.Date(2026, 10, 12, 21, 29, 0, 0, Colombo)) || IsPeak(time.Date(2026, 10, 12, 21, 30, 0, 0, Colombo)) {
		t.Error("dinner peak ends at 21:30")
	}
	if got := WithTip(p, 5000).Total.AmountMinor; got != 46000 {
		t.Errorf("with tip total = %d", got)
	}
}

func TestCompensation(t *testing.T) {
	d := &dispatchv1.Delivery{ToPickupKm: 2, Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING}
	if Compensation(d).Total.AmountMinor != 0 {
		t.Error("no rider, no compensation")
	}
	d.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED
	if Compensation(d).Total.AmountMinor != 9000 {
		t.Errorf("on the way = %v", Compensation(d))
	}
	d.Status = dispatchv1.DeliveryStatus_DELIVERY_STATUS_AT_RESTAURANT
	if Compensation(d).Total.AmountMinor != 18000+10000 {
		t.Errorf("at restaurant = %v", Compensation(d))
	}
}

func TestZonesAndDistances(t *testing.T) {
	if z := ZoneOf(&commonv1.GeoPoint{Lat: 6.911, Lng: 79.850}); z != "c03" {
		t.Errorf("Kollupitiya zone = %q", z)
	}
	if z := ZoneOf(&commonv1.GeoPoint{Lat: 7.29, Lng: 80.63}); z != "" {
		t.Errorf("Kandy zone = %q", z)
	}
	if z := ZoneOf(&commonv1.GeoPoint{}); z != "" {
		t.Errorf("null island zone = %q", z)
	}
	km := RoadKm(&commonv1.GeoPoint{Lat: 6.91, Lng: 79.851}, &commonv1.GeoPoint{Lat: 6.893, Lng: 79.856})
	if km < 2.2 || km > 2.6 {
		t.Errorf("Kollupitiya → Bambalapitiya road km = %v", km)
	}
	if TravelMinutes(5) != 15 || TravelMinutes(0) != 1 {
		t.Errorf("travel minutes = %d / %d", TravelMinutes(5), TravelMinutes(0))
	}
	mid := Lerp(&commonv1.GeoPoint{Lat: 0, Lng: 0}, &commonv1.GeoPoint{Lat: 2, Lng: 4}, 0.5)
	if mid.Lat != 1 || mid.Lng != 2 || Lerp(mid, mid, 7).Lat != 1 {
		t.Errorf("lerp = %v", mid)
	}
	p := MapPoint(150, 175) // Galle Road Kottu House on the illustrated map
	if ZoneOf(p) == "" {
		t.Errorf("map point %v not in a zone", p)
	}
}

func TestRankCandidatesPrefersRealRiders(t *testing.T) {
	cs := []Ranked{
		{Candidate: Candidate{RiderID: "sim-near", Km: 0.3}, Simulated: true},
		{Candidate: Candidate{RiderID: "nimal", Km: 2.5}, Real: true},
		{Candidate: Candidate{RiderID: "sim-mid", Km: 1.0}, Simulated: true},
	}
	got := RankCandidates(cs, true)
	if got[0].RiderID != "nimal" || got[1].RiderID != "sim-near" || got[2].RiderID != "sim-mid" {
		t.Fatalf("prefer real: %v", got)
	}
	got = RankCandidates(cs, false)
	if got[0].RiderID != "sim-near" || got[2].RiderID != "nimal" {
		t.Fatalf("nearest first: %v", got)
	}
	if cs[0].RiderID != "sim-near" {
		t.Fatal("input reordered")
	}
}

func TestMatchBackoff(t *testing.T) {
	want := []time.Duration{5 * time.Second, 5 * time.Second, 10 * time.Second, 20 * time.Second, 30 * time.Second, 30 * time.Second}
	for i, w := range want {
		if got := MatchBackoff(int32(i)); got != w {
			t.Errorf("attempt %d: %v, want %v", i, got, w)
		}
	}
}

func acceptedOrder(mode commonv1.FulfilmentMode, pay commonv1.PaymentMethodKind) *orderv1.OrderAccepted {
	return &orderv1.OrderAccepted{
		OrderId: "o1",
		ReadyBy: timestamppb.New(t0.Add(15 * time.Minute)),
		Order: &orderv1.Order{
			Id: "o1", OrderNumber: "KD-4821", Mode: mode, ZoneId: "c04", DeliveryCode: "4821",
			Customer:   &commonv1.Contact{Id: "c1", Name: "Dilini Fernando"},
			Restaurant: &orderv1.OrderRestaurant{Id: "r1", Name: "Galle Road Kottu House", Area: "Kollupitiya", Location: &commonv1.GeoPoint{Lat: 6.9105, Lng: 79.8502}},
			Address: &commonv1.Address{Line: "18/2 Daisy Villa Ave, Colombo 04", Area: "Bambalapitiya", Note: "Blue gate",
				Location: &commonv1.GeoPoint{Lat: 6.8932, Lng: 79.8571}},
			RiderNote: "Ring twice",
			Lines: []*orderv1.OrderLine{
				{Key: "a", Name: "Chicken cheese kottu", Quantity: 2, ChoiceNames: []string{"Large", "Extra cheese"}, Note: "medium spicy"},
				{Name: "Egg roti", Quantity: 1},
			},
			Payment: &commonv1.PaymentMethod{Kind: pay, CashPayingWith: &commonv1.Money{AmountMinor: 500000}},
			Totals:  &orderv1.OrderTotals{Total: &commonv1.Money{AmountMinor: 234000}, Tip: &commonv1.Money{AmountMinor: 0}},
			DueAt:   timestamppb.New(t0.Add(40 * time.Minute)),
		},
	}
}

func TestBuildDelivery(t *testing.T) {
	if BuildDelivery(acceptedOrder(commonv1.FulfilmentMode_FULFILMENT_MODE_PICKUP, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD), "d1", t0) != nil {
		t.Fatal("pickup orders need no rider")
	}
	row := BuildDelivery(acceptedOrder(commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH), "d1", t0)
	d := row.D
	if d.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING || d.ZoneId != "c04" || d.OrderNumber != "KD-4821" {
		t.Fatalf("delivery = %v", d)
	}
	if d.Dropoff.FirstName != "Dilini" || d.Dropoff.Note != "Blue gate · Ring twice" || d.Dropoff.MaskedPhone == "" {
		t.Errorf("dropoff = %v", d.Dropoff)
	}
	if len(d.Items) != 2 || d.Items[0].Options != "Large, Extra cheese, medium spicy" || d.Items[1].Id != "2" {
		t.Errorf("items = %v", d.Items)
	}
	if d.CashToCollect.AmountMinor != 234000 || d.CustomerPaysWith.AmountMinor != 500000 || d.TripKm <= 0 {
		t.Errorf("cash = %v / %v, trip %v", d.CashToCollect, d.CustomerPaysWith, d.TripKm)
	}
	if row.Code != "4821" || row.CustomerID != "c1" || row.NextAttemptAt == nil || !row.DueAt.Equal(t0.Add(40*time.Minute)) {
		t.Errorf("row = %+v", row)
	}
	card := BuildDelivery(acceptedOrder(commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD), "d2", t0)
	if card.D.CashToCollect.AmountMinor != 0 {
		t.Error("card orders collect nothing")
	}
}

func TestBuildOffer(t *testing.T) {
	c := NewCore(nil, nil, Options{}, nil)
	row := BuildDelivery(acceptedOrder(commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD), "d1", t0)
	o := c.BuildOffer(row, Ranked{Candidate: Candidate{RiderID: "r1", Position: &commonv1.GeoPoint{Lat: 6.9150, Lng: 79.8520}}}, t0)
	if o.RiderId != "r1" || o.Delivery.RiderId != "" || o.Status != dispatchv1.OfferStatus_OFFER_STATUS_OFFERED {
		t.Fatalf("offer = %v", o)
	}
	if !o.ExpiresAt.AsTime().Equal(t0.Add(30 * time.Second)) {
		t.Errorf("expires = %v", o.ExpiresAt.AsTime())
	}
	if o.Delivery.ToPickupKm <= 0 || o.Delivery.Pay.Total.AmountMinor <= PayBaseMinor {
		t.Errorf("pickup %v pay %v", o.Delivery.ToPickupKm, o.Delivery.Pay)
	}
	// Ready in 15 min, ~2 min away: the kitchen still needs ~13 min when the rider arrives.
	if o.NotReadyMinutes < 10 || o.NotReadyMinutes > 14 {
		t.Errorf("not ready minutes = %d", o.NotReadyMinutes)
	}
}

func TestCheckPickup(t *testing.T) {
	items := []*dispatchv1.DeliveryItem{{Id: "a"}, {Id: "b"}}
	if reason(CheckPickup(items, []string{"a"}, false)) != "ITEMS_NOT_CHECKED" {
		t.Error("missing item must fail")
	}
	if CheckPickup(items, []string{"b", "a"}, false) != nil || CheckPickup(items, nil, true) != nil {
		t.Error("all ticked or sealed must pass")
	}
}

func TestCheckCompletion(t *testing.T) {
	cash := &DeliveryRow{Code: "4821", D: &dispatchv1.Delivery{Payment: commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH, CashToCollect: lkr(234000)}}
	cases := map[string]struct {
		d    *DeliveryRow
		req  *dispatchv1.CompleteDeliveryRequest
		want string
	}{
		"no proof":              {cash, &dispatchv1.CompleteDeliveryRequest{}, "PROOF_REQUIRED"},
		"wrong code":            {cash, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "1234", CashCollected: lkr(234000)}, "DELIVERY_CODE_MISMATCH"},
		"cash short":            {cash, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "4821", CashCollected: lkr(200000)}, "CASH_SHORT"},
		"ok, change":            {cash, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: " 4821 ", CashCollected: lkr(500000)}, ""},
		"photo no ref":          {cash, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_PHOTO, CashCollected: lkr(234000)}, "PHOTO_REQUIRED"},
		"photo":                 {cash, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_PHOTO, PhotoRef: "door.jpg", CashCollected: lkr(234000)}, ""},
		"card no code on order": {&DeliveryRow{D: &dispatchv1.Delivery{}}, &dispatchv1.CompleteDeliveryRequest{Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "9999"}, ""},
	}
	for name, tc := range cases {
		if got := reason(CheckCompletion(tc.d, tc.req)); got != tc.want {
			t.Errorf("%s: %q, want %q", name, got, tc.want)
		}
	}
}

func TestReadyAt(t *testing.T) {
	d := &DeliveryRow{D: &dispatchv1.Delivery{ReadyBy: timestamppb.New(t0.Add(6 * time.Minute))}}
	if got := ReadyAt(d, t0); !got.Equal(t0.Add(6 * time.Minute)) {
		t.Errorf("kitchen estimate: %v", got)
	}
	if got := ReadyAt(d, t0.Add(10*time.Minute)); !got.Equal(t0.Add(13 * time.Minute)) {
		t.Errorf("past estimate: %v", got)
	}
	ready := t0
	d.FoodReadyAt = &ready
	if got := ReadyAt(d, t0.Add(time.Minute)); !got.Equal(t0.Add(time.Minute)) {
		t.Errorf("food ready: %v", got)
	}
}

func TestQuests(t *testing.T) {
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, Colombo) // Wednesday
	trips := []time.Time{
		time.Date(2026, 10, 12, 9, 0, 0, 0, Colombo),   // Monday
		time.Date(2026, 10, 14, 9, 0, 0, 0, Colombo),   // today
		time.Date(2026, 10, 14, 12, 30, 0, 0, Colombo), // today, lunch
		time.Date(2026, 10, 14, 13, 59, 0, 0, Colombo), // today, lunch
	}
	q := Quests(now, trips)
	if len(q) != 3 || q[0].Done != 3 || q[0].Title != "Complete 9 more trips by 10 pm" || q[1].Done != 2 || q[2].Done != 4 {
		t.Fatalf("quests = %v", q)
	}
	if !q[2].EndsAt.AsTime().Equal(time.Date(2026, 10, 19, 0, 0, 0, 0, Colombo)) {
		t.Errorf("week ends %v", q[2].EndsAt.AsTime())
	}
	if WeekStart(now) != time.Date(2026, 10, 12, 0, 0, 0, 0, Colombo) {
		t.Errorf("week start = %v", WeekStart(now))
	}
}

func TestSeedRiders(t *testing.T) {
	riders := SeedRiders(t0)
	if len(riders) != 48 {
		t.Fatalf("riders = %d", len(riders))
	}
	n := riders[0]
	if n.R.Id != "00000000-0000-7000-8001-000000000101" || n.R.UserId != "00000000-0000-7000-8005-000000000004" ||
		n.R.Name != "Nimal Perera" || n.R.Vehicle.Plate != "WP BCD-4521" || n.R.Rating != 4.9 || n.Simulated ||
		n.R.Status != dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE || !n.R.CashAllowed {
		t.Fatalf("nimal = %v", n.R)
	}
	if riders[1].R.Name != "Kasun Perera" || riders[1].R.UserId != "" || !riders[1].Simulated {
		t.Errorf("kasun = %v", riders[1].R)
	}
	online, nearKollupitiya, overLimit := 0, 0, 0
	for _, r := range riders {
		if r.R.Status == dispatchv1.RiderStatus_RIDER_STATUS_ONLINE {
			online++
			if HaversineKm(*r.LastLat, *r.LastLng, 6.91, 79.851) < 3 {
				nearKollupitiya++
			}
		}
		if !r.R.CashAllowed {
			overLimit++
		}
	}
	if online != 29 || nearKollupitiya < 4 || overLimit != 2 {
		t.Errorf("online %d, near Kollupitiya %d, over cash limit %d", online, nearKollupitiya, overLimit)
	}
	if riders[46].R.Status != dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED {
		t.Error("R-147 is suspended")
	}
	// Deterministic.
	if again := SeedRiders(t0); again[7].R.Phone != riders[7].R.Phone {
		t.Error("seed is not deterministic")
	}
	trips := nimalTrips(time.Date(2026, 10, 12, 23, 0, 0, 0, Colombo))
	if len(trips) != 9 || trips[0].D.RiderId != NimalRiderID || trips[0].D.Pay.Total.AmountMinor != 18000+15000 {
		t.Errorf("trips = %d %v", len(trips), trips[0].D)
	}
	if apps := seedApplications(t0); len(apps) != 4 || apps[0].Id != "00000000-0000-7000-8020-000000000301" {
		t.Errorf("applications = %v", apps)
	}
}

func TestBuildSnapshot(t *testing.T) {
	due := t0.Add(-5 * time.Minute)
	open := []*DeliveryRow{
		{D: &dispatchv1.Delivery{Id: "d1", OrderId: "o1", OrderNumber: "KD-1", ZoneId: "c03", Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED,
			RequestedAt: timestamppb.New(t0.Add(-8 * time.Minute)), Pickup: &dispatchv1.PickupStop{Location: &commonv1.GeoPoint{Lat: 6.91, Lng: 79.85}}}, DueAt: &due},
		{D: &dispatchv1.Delivery{Id: "d2", OrderId: "o2", OrderNumber: "KD-2", ZoneId: "c04", Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP, RiderId: "r1",
			RequestedAt: timestamppb.New(t0), Pickup: &dispatchv1.PickupStop{Location: &commonv1.GeoPoint{Lat: 6.89, Lng: 79.85}}}},
	}
	online := []*dispatchv1.Rider{
		{Id: "r1", FirstName: "Kasun", Status: dispatchv1.RiderStatus_RIDER_STATUS_ON_JOB, Position: &commonv1.GeoPoint{Lat: 6.893, Lng: 79.856}, PositionZoneId: "c04"},
		{Id: "r2", FirstName: "Ishara", Status: dispatchv1.RiderStatus_RIDER_STATUS_ONLINE, Position: &commonv1.GeoPoint{Lat: 6.91, Lng: 79.851}, PositionZoneId: "c03"},
	}
	over := []*dispatchv1.Rider{{Id: "r9", Name: "Saman Kumara", CashHeld: lkr(2145000), CashLimit: lkr(1500000)}}
	s := BuildSnapshot(t0, open, online, over, DayStats{OrdersToday: 7, RequestedToday: []time.Time{t0}})
	if s.InProgress != 2 || s.WaitingForRider != 1 || s.Late != 1 || s.RidersOnline != 2 || s.OrdersToday != 7 {
		t.Fatalf("counts = %v", s)
	}
	if s.Attention[0].Kind != dispatchv1.AttentionKind_ATTENTION_KIND_UNMATCHED_DELIVERY {
		t.Errorf("most urgent = %v", s.Attention[0])
	}
	var cash bool
	for _, a := range s.Attention {
		if a.Kind == dispatchv1.AttentionKind_ATTENTION_KIND_RIDER_CASH && a.Title == "Saman Kumara is holding Rs 21,450" {
			cash = true
		}
	}
	if !cash {
		t.Errorf("cash attention missing: %v", s.Attention)
	}
	if len(s.Zones) != len(Zones) || s.ShortestZoneCode == "" || len(s.OrdersByHour) != 11 || s.OrdersByHour[10].Today != 1 {
		t.Errorf("zones %d shortest %q hours %v", len(s.Zones), s.ShortestZoneCode, s.OrdersByHour)
	}
	var riderDot, onTheWay bool
	for _, d := range s.Dots {
		riderDot = riderDot || (d.Kind == dispatchv1.DotKind_DOT_KIND_RIDER && d.Id == "r2")
		onTheWay = onTheWay || (d.Kind == dispatchv1.DotKind_DOT_KIND_ON_THE_WAY && d.Location.Lat == 6.893)
	}
	if !riderDot || !onTheWay {
		t.Errorf("dots = %v", s.Dots)
	}
}

func TestRequireStaff(t *testing.T) {
	as := func(roles ...string) context.Context {
		return auth.WithIdentity(context.Background(), auth.Identity{UserID: "u", Roles: roles})
	}
	if requireStaff(context.Background()) != nil || requireStaff(as("ops")) != nil || requireStaff(as("customer", "admin")) != nil {
		t.Error("internal and staff callers are allowed")
	}
	if reason(requireStaff(as("rider", "customer"))) != "STAFF_ONLY" {
		t.Error("riders are not staff")
	}
}

func TestMisc(t *testing.T) {
	if rupees(2145000) != "Rs 21,450" || rupees(50000) != "Rs 500" || rupees(123456700) != "Rs 1,234,567" {
		t.Errorf("rupees: %s %s %s", rupees(2145000), rupees(50000), rupees(123456700))
	}
	if zoneForCity("Kollupitiya, Colombo 3") != "c03" || zoneForCity("Galle") != "" {
		t.Error("zoneForCity")
	}
	if b := maskBank(&commonv1.BankAccount{AccountNumber: "8001 2345 4417"}); b.AccountNumber != "" || b.AccountLast4 != "4417" {
		t.Errorf("bank = %v", b)
	}
	if maskedPhone("3", "o1") != maskedPhone("3", "o1") || len(maskedPhone("3", "o1")) != len("+94 11 520 3381") {
		t.Error("masked phone")
	}
}
