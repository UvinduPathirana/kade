package dispatch

import (
	"context"
	"fmt"
	"slices"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
)

// Seeded ids (docs/backend/CONVENTIONS.md "Seeded ids"): riders are group 8001 (rider app R-101 →
// 101). Dispatch-local seeds use groups 8020 (rider applications, admin RAP-301 → 301), 8021
// (Nimal's past deliveries) and 8022 (the order ids those history rows point at).
func SeedID(group string, n int) string { return fmt.Sprintf("00000000-0000-7000-%s-%012d", group, n) }

var (
	NimalRiderID = SeedID("8001", 101)
	NimalUserID  = SeedID("8005", 4)
)

// riderNames are the admin console's riders R-101…R-148 (apps/admin/src/api/mock/partners.ts);
// R-101 is Nimal Perera of the rider app and Keycloak user nimal.
var riderNames = []string{
	"Nimal Perera", "Kasun Perera", "Ishara Madushan", "Tharindu Silva", "Mohamed Nazeer", "Saman Kumara",
	"Ruwan Jayasuriya", "Dilshan Rathnayake", "Chamara Wijesinghe", "Ashan de Silva", "Pradeep Kumar",
	"Lahiru Gunasekara", "Fazal Mohideen", "Sampath Herath", "Janaka Bandara", "Nuwan Pathirana", "Kavinda Lakmal",
	"Suresh Rajan", "Amila Dissanayake", "Roshan Weerasinghe", "Chathura Senanayake", "Hiran Abeysekara",
	"Gayan Kodikara", "Malith Ekanayake", "Sajith Liyanage", "Thilina Ranasinghe", "Asanka Peiris", "Rifkhan Ahamed",
	"Upul Samarasinghe", "Dinuka Wanigasekara", "Buddhika Alwis", "Hasitha Mendis", "Prasanna Karunaratne",
	"Isuru Udana", "Sandun Jayawardena", "Ravi Shankar", "Mahesh Gamage", "Kelum Rajapaksha", "Nalin Abeywardena",
	"Sahan Wickrama", "Yasiru Kulatunga", "Ajith Premadasa", "Shehan Fonseka", "Danushka Mallawarachchi",
	"Viraj Seneviratne", "Rukshan Cooray", "Pubudu Hettiarachchi", "Niroshan Thevarajah",
}

var busyZones = []string{"c03", "c03", "c04", "c04", "c06", "c07", "c02", "c08", "c05", "deh", "c01", "c13", "c10", "raj",
	"nug", "c11", "c12", "c09", "c14", "c15"}

// rng is a tiny deterministic generator so seeds are identical on every machine.
type rng struct{ s uint64 }

func seeded(n int) *rng { return &rng{s: uint64(n)*2654435761 + 1013904223} }
func (r *rng) next() float64 {
	r.s = r.s*6364136223846793005 + 1442695040888963407
	return float64(r.s>>11) / float64(1<<53)
}
func (r *rng) intn(lo, hi int) int     { return lo + int(r.next()*float64(hi-lo+1)) }
func (r *rng) pick(xs []string) string { return xs[r.intn(0, len(xs)-1)] }

func doc(kind, name, file, expires string, status commonv1.DocumentStatus, fields ...string) *commonv1.PartnerDocument {
	d := &commonv1.PartnerDocument{Id: kind, Kind: kind, Name: name, FileName: file, FileRef: "seed/" + file, Status: status, ExpiresOn: expires}
	for i := 0; i+1 < len(fields); i += 2 {
		d.Fields = append(d.Fields, &commonv1.DocumentField{Label: fields[i], Value: fields[i+1]})
	}
	return d
}

// docStatus marks documents expiring within 30 days of seeding (or already expired).
func docStatus(expires string, now time.Time) commonv1.DocumentStatus {
	t, err := time.Parse("2006-01-02", expires)
	switch {
	case err != nil:
		return commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED
	case t.Before(now):
		return commonv1.DocumentStatus_DOCUMENT_STATUS_EXPIRED
	case t.Before(now.AddDate(0, 0, 30)):
		return commonv1.DocumentStatus_DOCUMENT_STATUS_EXPIRING
	}
	return commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED
}

// SeedRiders builds the demo fleet: Nimal (real login, offline until he goes online in the app)
// and 47 riders without logins, 29 of them online around their home zones for the simulator.
func SeedRiders(now time.Time) []*RiderRow {
	motorbikes := []string{"Bajaj Pulsar 150", "Honda CB Shine", "TVS Apache RTR 160", "Hero Splendor", "Yamaha FZ"}
	banks := []string{"Commercial Bank", "HNB", "Sampath Bank", "Bank of Ceylon", "People's Bank"}
	out := make([]*RiderRow, 0, len(riderNames))
	for i, name := range riderNames {
		r := seeded(500 + i)
		n := 101 + i
		id := SeedID("8001", n)
		vt, model := dispatchv1.VehicleType_VEHICLE_TYPE_MOTORBIKE, r.pick(motorbikes)
		plate := fmt.Sprintf("WP B%s%s-%04d", r.pick([]string{"A", "B", "C", "D"}), r.pick([]string{"K", "L", "M"}), r.intn(1000, 9999))
		switch {
		case i%9 == 4:
			vt, model, plate = dispatchv1.VehicleType_VEHICLE_TYPE_TUK_TUK, "Bajaj RE", fmt.Sprintf("WP AA%s-%04d", r.pick([]string{"B", "C", "E"}), r.intn(1000, 9999))
		case i%11 == 7:
			vt, model, plate = dispatchv1.VehicleType_VEHICLE_TYPE_BICYCLE, "Raleigh city bike", ""
		}
		home := busyZones[i%len(busyZones)]
		zones := []string{home}
		if nb := r.pick(busyZones); nb != home {
			zones = append(zones, nb)
		}
		status, reason := dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE, ""
		switch {
		case i == 46:
			status, reason = dispatchv1.RiderStatus_RIDER_STATUS_SUSPENDED, "Three customer complaints about rude behaviour, under review"
		case i > 0 && i < 30:
			status = dispatchv1.RiderStatus_RIDER_STATUS_ONLINE
		}
		cashRs := r.intn(1, 12) * 850
		switch {
		case i == 5:
			cashRs = 21450
		case i == 17:
			cashRs = 18200
		case status != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE:
			cashRs = r.intn(0, 3) * 1000
		}
		tripsWeek := r.intn(25, 70)
		if status != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE {
			tripsWeek = r.intn(8, 40)
		}
		licenceExp := fmt.Sprintf("2027-%02d-1%d", r.intn(1, 9), r.intn(0, 9))
		if i == 3 {
			licenceExp = "2026-10-18"
		} else if i == 12 {
			licenceExp = "2026-10-04"
		}
		insuranceExp := fmt.Sprintf("2027-%02d-2%d", r.intn(1, 9), r.intn(0, 8))
		if i == 8 {
			insuranceExp = "2026-10-27"
		}
		revenueExp := fmt.Sprintf("2027-%02d-0%d", r.intn(1, 9), r.intn(1, 9))
		docs := []*commonv1.PartnerDocument{
			doc("licence", "Driving licence", "licence.jpg", licenceExp, docStatus(licenceExp, now), "Licence no.", fmt.Sprintf("B%d", r.intn(1000000, 9999999))),
			doc("revenue", "Revenue licence", "revenue.jpg", revenueExp, docStatus(revenueExp, now), "Vehicle no.", plate),
			doc("insurance", "Insurance", "insurance.pdf", insuranceExp, docStatus(insuranceExp, now), "Insurer", r.pick([]string{"Ceylinco", "Sri Lanka Insurance", "Allianz", "Fairfirst"})),
			doc("nic", "NIC", "nic.jpg", "", commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED, "NIC no.", fmt.Sprintf("19%d%d", r.intn(85, 99), r.intn(10000000, 99999999))),
		}
		if vt == dispatchv1.VehicleType_VEHICLE_TYPE_BICYCLE {
			docs = slices.DeleteFunc(docs, func(d *commonv1.PartnerDocument) bool { return d.GetKind() == "revenue" })
		}
		joined := time.Date(2024+r.intn(0, 2), time.Month(r.intn(1, 9)), r.intn(1, 9), 9, 0, 0, 0, Colombo)
		rider := &dispatchv1.Rider{
			Id: id, Name: name, FirstName: firstName(name),
			Phone:       fmt.Sprintf("+94 7%d %03d %04d", r.intn(0, 8), r.intn(100, 999), r.intn(1000, 9999)),
			MaskedPhone: fmt.Sprintf("+94 11 520 4%03d", n), Vehicle: &dispatchv1.Vehicle{Type: vt, Model: model, Plate: plate},
			Status: status, StatusReason: reason, ZoneIds: zones,
			Rating: float64(r.intn(43, 50)) / 10, RatingCount: int32(r.intn(40, 1500)), AcceptanceRate: float64(r.intn(72, 99)) / 100,
			CashHeld: lkr(int64(cashRs) * 100), CashLimit: lkr(DefaultCashLimitMinor), CashAllowed: int64(cashRs)*100 <= DefaultCashLimitMinor,
			TripsWeek: int32(tripsWeek), JoinedAt: ts(joined),
			Bank:             &commonv1.BankAccount{Bank: r.pick(banks), Branch: zoneName(home), AccountName: name, AccountLast4: fmt.Sprintf("%04d", r.intn(0, 9999))},
			DepositReference: fmt.Sprintf("KR-%04d-%s", r.intn(1000, 9999), initials(name)),
			Documents:        docs,
		}
		z, _ := ZoneByID(home)
		lat, lng := z.Lat+(r.next()-0.5)*0.016, z.Lng+(r.next()-0.5)*0.016
		row := &RiderRow{R: rider, Simulated: true, LastLat: &lat, LastLng: &lng, LastSeen: &now}
		if i == 0 {
			nimal(row, now)
		}
		out = append(out, row)
	}
	return out
}

// nimal is the rider app's profile (apps/rider/src/api/mock/data.ts) on the Keycloak user nimal.
func nimal(row *RiderRow, now time.Time) {
	r := row.R
	r.UserId = NimalUserID
	r.Phone = "+94 77 412 5583"
	r.Vehicle = &dispatchv1.Vehicle{Type: dispatchv1.VehicleType_VEHICLE_TYPE_MOTORBIKE, Model: "Bajaj Pulsar 150", Plate: "WP BCD-4521"}
	r.Status, r.StatusReason = dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE, ""
	r.ZoneIds = []string{"c03", "c04"}
	r.Rating, r.RatingCount, r.AcceptanceRate = 4.9, 1284, 0.94
	// Rs 17,450 collected − Rs 3,120 owed = Rs 14,330 held, under the Rs 15,000 limit.
	r.CashHeld, r.CashLimit, r.CashAllowed = lkr(1_433_000), lkr(DefaultCashLimitMinor), true
	r.TripsWeek = 0
	r.JoinedAt = ts(time.Date(2024, 3, 4, 9, 0, 0, 0, Colombo))
	r.Bank = &commonv1.BankAccount{Bank: "Commercial Bank", Branch: "Kollupitiya", AccountName: "Nimal Perera", AccountLast4: "4417"}
	r.DepositReference = "KR-4521-NP"
	r.Documents = []*commonv1.PartnerDocument{
		doc("licence", "Driving licence", "licence.jpg", "2029-04-18", docStatus("2029-04-18", now), "Licence no.", "B4521873"),
		doc("revenue", "Revenue licence", "revenue.jpg", "2026-10-31", docStatus("2026-10-31", now), "Vehicle no.", "WP BCD-4521"),
		doc("insurance", "Insurance", "insurance.pdf", "2027-02-11", docStatus("2027-02-11", now), "Insurer", "Ceylinco"),
		doc("nic", "NIC", "nic.jpg", "", commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED, "NIC no.", "199112345678"),
	}
	home := MapPoint(255, 120) // rider app HOME_BASE
	row.Simulated = false
	row.LastLat, row.LastLng = &home.Lat, &home.Lng
}

func zoneName(id string) string {
	if z, ok := ZoneByID(id); ok {
		return z.Name
	}
	return ""
}

// nimalTrips are the rider app's past trips (mock seedTrips), as delivered deliveries.
func nimalTrips(now time.Time) []*DeliveryRow {
	type trip struct {
		daysAgo, h, m                              int
		restaurant, pickupArea, dropArea, customer string
		km                                         float64
		distRs, tipRs, boostRs                     int64
		cash                                       bool
		cashRs                                     int64
		rating                                     int32
	}
	rows := []trip{
		{0, 8, 5, "Perera & Sons", "Kollupitiya", "Cinnamon Gardens", "Ruwani", 2.2, 150, 0, 0, false, 0, 5},
		{0, 9, 10, "Barista Kollupitiya", "Kollupitiya", "Bambalapitiya", "Sahan", 2.8, 190, 50, 0, true, 1420, 5},
		{0, 10, 40, "Saraswathie Lodge", "Bambalapitiya", "Wellawatte", "Priya", 2.5, 170, 0, 0, false, 0, 0},
		{0, 12, 15, "Galle Road Kottu House", "Kollupitiya", "Havelock Town", "Thilina", 3.9, 260, 100, 60, false, 0, 5},
		{0, 15, 20, "Upali's by Nawaloka", "Cinnamon Gardens", "Dehiwala", "Roshan", 6.4, 430, 150, 0, false, 0, 5},
		{1, 12, 45, "Galle Road Kottu House", "Kollupitiya", "Wellawatte", "Charith", 4.4, 300, 0, 60, true, 3200, 5},
		{2, 12, 10, "Upali's by Nawaloka", "Cinnamon Gardens", "Kollupitiya", "Hiran", 1.9, 140, 0, 0, false, 0, 5},
		{2, 13, 25, "Barista Kollupitiya", "Kollupitiya", "Wellawatte", "Sanduni", 4.0, 270, 100, 0, true, 1780, 5},
		{2, 19, 15, "Galle Road Kottu House", "Kollupitiya", "Bambalapitiya", "Kasun", 2.7, 190, 0, 80, false, 0, 4},
	}
	pts := map[string][2]float64{
		"Kollupitiya": {150, 60}, "Bambalapitiya": {150, 300}, "Cinnamon Gardens": {340, 175}, "Havelock Town": {340, 395},
		"Wellawatte": {150, 395}, "Dehiwala": {150, 500},
	}
	home := MapPoint(255, 120)
	today := DayStart(now)
	var out []*DeliveryRow
	for i, t := range rows {
		accepted := today.AddDate(0, 0, -t.daysAgo).Add(time.Duration(t.h)*time.Hour + time.Duration(t.m)*time.Minute)
		minutes := int(12 + t.km*4)
		delivered := accepted.Add(time.Duration(minutes) * time.Minute)
		if delivered.After(now) {
			continue
		}
		p, q := pts[t.pickupArea], pts[t.dropArea]
		if t.dropArea == t.pickupArea {
			q = [2]float64{340, 60}
		}
		toPickup := round1(t.km * 0.3)
		payment, cash := commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD, int64(0)
		if t.cash {
			payment, cash = commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH, t.cashRs*100
		}
		proof := dispatchv1.ProofKind_PROOF_KIND_CODE
		if i%3 == 1 {
			proof = dispatchv1.ProofKind_PROOF_KIND_PHOTO
		}
		n := 8800 - i
		d := &dispatchv1.Delivery{
			Id: SeedID("8021", n), OrderId: SeedID("8022", n), OrderNumber: fmt.Sprintf("KD-%d", 3100+i*37), ZoneId: ZoneOf(MapPoint(p[0], p[1])),
			Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED, RiderId: NimalRiderID,
			Pickup:     &dispatchv1.PickupStop{Name: t.restaurant, Area: t.pickupArea, Location: MapPoint(p[0], p[1])},
			Dropoff:    &dispatchv1.DropoffStop{FirstName: t.customer, Area: t.dropArea, Location: MapPoint(q[0], q[1])},
			ToPickupKm: toPickup, TripKm: round1(t.km - toPickup), Minutes: int32(minutes),
			Pay:     payOf(PayBaseMinor, t.distRs*100, t.tipRs*100, t.boostRs*100),
			Payment: payment, CashToCollect: lkr(cash), CashCollected: lkr(cash),
			RequestedAt: ts(accepted.Add(-time.Minute)), AssignedAt: ts(accepted), ArrivedAtRestaurantAt: ts(accepted.Add(6 * time.Minute)),
			PickedUpAt: ts(accepted.Add(11 * time.Minute)), ArrivedAtCustomerAt: ts(delivered.Add(-time.Minute)), DeliveredAt: ts(delivered),
			Proof: proof, Attempts: 1,
		}
		if proof == dispatchv1.ProofKind_PROOF_KIND_PHOTO {
			d.ProofPhotoRef = "seed/door-photo.jpg"
		}
		out = append(out, &DeliveryRow{D: d, FromLat: &home.Lat, FromLng: &home.Lng, CustomerRating: t.rating})
	}
	return out
}

// seedApplications are the admin console's pending rider applications.
func seedApplications(now time.Time) []*dispatchv1.RiderApplication {
	docs := func(ok bool) []*commonv1.PartnerDocument {
		revenue := "2027-06-30"
		if !ok {
			revenue = "2026-09-30"
		}
		pending := commonv1.DocumentStatus_DOCUMENT_STATUS_PENDING
		return []*commonv1.PartnerDocument{
			doc("licence", "Driving licence", "licence-front.jpg", "2031-06-12", pending, "Licence no.", "B4471920", "Classes", "A1, B1", "Valid until", "12 Jun 2031"),
			doc("revenue", "Revenue licence", "revenue-licence.jpg", revenue, pending, "Vehicle no.", "WP BKL-4471"),
			doc("insurance", "Insurance", "insurance.pdf", "", pending, "Insurer", "Ceylinco General", "Cover", "Third party"),
			doc("nic", "NIC", "nic.jpg", "", pending, "NIC no.", "200012345678"),
			doc("police", "Police clearance", "police-report.pdf", "", pending, "Issued", "22 Sep 2026, Bambalapitiya"),
		}
	}
	mk := func(n int, name, phone string, v dispatchv1.VehicleType, zones []string, ago time.Duration, ok bool) *dispatchv1.RiderApplication {
		return &dispatchv1.RiderApplication{
			Id: SeedID("8020", n), Name: name, Phone: phone, City: zoneName(zones[0]), Vehicle: v, ZoneIds: zones, Documents: docs(ok),
			Bank:    &commonv1.BankAccount{Bank: "Commercial Bank", Branch: zoneName(zones[0]), AccountName: name, AccountLast4: fmt.Sprintf("%04d", 1000+n)},
			Lessons: []string{"road-safety", "food-handling", "cash"}, Status: commonv1.ApplicationStatus_APPLICATION_STATUS_PENDING,
			SubmittedAt: ts(now.Add(-ago)),
		}
	}
	apps := []*dispatchv1.RiderApplication{
		mk(301, "Sachintha Rajapakse", "+94 77 331 0921", dispatchv1.VehicleType_VEHICLE_TYPE_MOTORBIKE, []string{"c04", "c06"}, 26*time.Hour, true),
		mk(302, "Mohamed Ilham", "+94 75 802 4410", dispatchv1.VehicleType_VEHICLE_TYPE_MOTORBIKE, []string{"c02", "c03"}, 9*time.Hour, false),
		mk(305, "Tharaka Jayalath", "+94 71 640 2208", dispatchv1.VehicleType_VEHICLE_TYPE_BICYCLE, []string{"c07"}, 2*time.Hour, true),
		mk(306, "Kumaran Nadarajah", "+94 76 115 7720", dispatchv1.VehicleType_VEHICLE_TYPE_TUK_TUK, []string{"c06", "deh"}, 35*time.Minute, true),
	}
	for _, d := range apps[0].Documents[:3] {
		d.Status = commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED
	}
	return apps
}

// Seed inserts the demo fleet, Nimal's trip history and pending applications. Idempotent:
// existing rows are never overwritten.
func (c *Core) Seed(ctx context.Context) error {
	now := c.Now()
	return c.inTx(ctx, func(tx pgx.Tx) error {
		for _, r := range SeedRiders(now) {
			if err := saveRider(ctx, tx, r, true); err != nil {
				return fmt.Errorf("seed rider %s: %w", r.R.GetId(), err)
			}
		}
		for _, d := range nimalTrips(now) {
			if _, err := saveDelivery(ctx, tx, d, true); err != nil {
				return fmt.Errorf("seed trip %s: %w", d.D.GetId(), err)
			}
		}
		for _, app := range seedApplications(now) {
			if _, err := tx.Exec(ctx, `INSERT INTO rider_applications (id, phone, status, submitted_at, data)
			  SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM rider_applications WHERE id = $1)`,
				app.GetId(), digits(app.GetPhone()), int16(app.GetStatus()), app.GetSubmittedAt().AsTime(), mustMarshal(app)); err != nil {
				return fmt.Errorf("seed application %s: %w", app.GetId(), err)
			}
		}
		return nil
	})
}

// Reconcile makes the GEO index agree with Postgres: every ONLINE rider is in it (at their last
// known position), nobody else is. Runs at start and every minute; it repairs Redis updates lost
// after a commit and a flushed Redis.
func (c *Core) Reconcile(ctx context.Context) error {
	online, err := listRiders(ctx, c.Pool, `WHERE status = $1`, int16(dispatchv1.RiderStatus_RIDER_STATUS_ONLINE))
	if err != nil {
		return err
	}
	members, err := c.Fleet.AvailableMembers(ctx)
	if err != nil {
		return err
	}
	inIndex := map[string]bool{}
	for _, m := range members {
		inIndex[m] = true
	}
	want := map[string]bool{}
	for _, r := range online {
		id := r.R.GetId()
		want[id] = true
		if inIndex[id] {
			continue
		}
		p := c.lastPosition(ctx, r)
		if p == nil {
			p = homeZonePoint(r.R)
		}
		seen := c.Now()
		if r.LastSeen != nil && !r.Simulated {
			seen = *r.LastSeen
		}
		if err := c.Fleet.MakeAvailable(ctx, id, p, seen); err != nil {
			return err
		}
	}
	var stale []string
	for _, m := range members {
		if !want[m] {
			stale = append(stale, m)
		}
	}
	return c.Fleet.MakeUnavailable(ctx, stale...)
}

// RunReconciler calls Reconcile every interval until ctx ends.
func (c *Core) RunReconciler(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := c.Reconcile(ctx); err != nil && ctx.Err() == nil {
				c.Log.WarnContext(ctx, "reconciling the GEO index failed", "err", err)
			}
		}
	}
}

func mustMarshal(m proto.Message) []byte {
	b, _ := proto.Marshal(m)
	return b
}
