//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	ledgerv1 "github.com/UvinduPathirana/kade/gen/go/kade/ledger/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/app"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/config"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/dispatch"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/grpcx"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/kafka"
)

var (
	st     stack
	a      *app.App
	jobs   dispatchv1.DispatchServiceClient
	ops    dispatchv1.DispatchOpsServiceClient
	riders dispatchv1.RiderServiceClient
	raw    *kgo.Client
)

func TestMain(m *testing.M) {
	st = resolveStack()
	fmt.Printf("integration: using shared stack via %s\n", st.Where)
	cfg := config.Config{
		// Own consumer groups so a running dispatch container does not steal our records.
		ServiceName: "dispatch-it", Version: "test", GRPCPort: 0, HTTPPort: 0,
		DatabaseURL: st.DatabaseURL, KafkaBrokers: st.Brokers, RedisURL: st.RedisURL, LogLevel: slog.LevelWarn,
		EventTopics: []string{"kade.order.events", "kade.ledger.events", "kade.review.events"}, LocationsTopic: "kade.rider.locations",
		OfferTimeout: 3 * time.Second, MatchRadiiKm: []float64{3, 6, 12}, MatchFailAfter: 3, ReofferAfter: time.Second,
		RiderStaleAfter: time.Hour, PreferRealRiders: true,
		MaxEventAge: time.Minute, // ignore other agents' history on the shared topics
		SeedOnStart: true, RPCTimeout: 5 * time.Second, ShutdownTimeout: 10 * time.Second, MigrateOnStart: true,
	}
	ctx, cancel := context.WithCancel(context.Background())
	var err error
	if a, err = app.New(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "app.New:", err)
		os.Exit(1)
	}
	runErr := make(chan error, 1)
	go func() { runErr <- a.Run(ctx) }()
	conn, err := grpcx.Dial(a.GRPCAddr.String())
	if err != nil {
		panic(err)
	}
	jobs, ops, riders = dispatchv1.NewDispatchServiceClient(conn), dispatchv1.NewDispatchOpsServiceClient(conn), dispatchv1.NewRiderServiceClient(conn)
	if raw, err = kgo.NewClient(kgo.SeedBrokers(st.Brokers...)); err != nil {
		panic(err)
	}

	code := m.Run()
	cleanup()
	conn.Close()
	raw.Close()
	cancel()
	select {
	case err := <-runErr:
		if err != nil {
			fmt.Fprintln(os.Stderr, "Run returned:", err)
			code = 1
		}
	case <-time.After(15 * time.Second):
		fmt.Fprintln(os.Stderr, "graceful shutdown timed out")
		code = 1
	}
	os.Exit(code)
}

// cleanup removes what the tests created so the shared demo database stays clean.
func cleanup() {
	ctx := context.Background()
	ids, _ := a.Pool.Query(ctx, `SELECT id::text FROM riders WHERE user_id LIKE 'it-user-%'`)
	var riderIDs []string
	for ids.Next() {
		var id string
		_ = ids.Scan(&id)
		riderIDs = append(riderIDs, id)
	}
	ids.Close()
	if len(riderIDs) > 0 {
		_ = a.Core.Fleet.MakeUnavailable(ctx, riderIDs...)
	}
	for _, q := range []string{
		`DELETE FROM customer_messages WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_number LIKE 'KD-IT%')`,
		`DELETE FROM offers WHERE delivery_id IN (SELECT id FROM deliveries WHERE order_number LIKE 'KD-IT%')`,
		`DELETE FROM deliveries WHERE order_number LIKE 'KD-IT%'`,
		`DELETE FROM riders WHERE user_id LIKE 'it-user-%'`,
		`DELETE FROM rider_applications WHERE user_id LIKE 'it-user-%'`,
	} {
		if _, err := a.Pool.Exec(ctx, q); err != nil {
			fmt.Fprintln(os.Stderr, "cleanup:", err)
		}
	}
}

func as(userID string, roles ...string) context.Context {
	return metadata.AppendToOutgoingContext(context.Background(), "x-user-id", userID, "x-roles", strings.Join(roles, ","))
}

var opsCtx = as("00000000-0000-7000-8005-000000000005", "ops")

func eventually(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// must unwraps (value, error); a failing call panics, which fails the test with the error.
func must[T any](v T, err error) T {
	if err != nil {
		panic(fmt.Sprintf("unexpected error: %v", err))
	}
	return v
}

// publish sends an event the way Debezium's outbox router does.
func publish(t *testing.T, topic, key string, msg proto.Message) {
	t.Helper()
	b, err := proto.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := uuid.NewV7()
	rec := &kgo.Record{Topic: topic, Key: []byte(key), Value: b, Headers: []kgo.RecordHeader{
		{Key: kafka.HeaderEventID, Value: []byte(id.String())},
		{Key: kafka.HeaderEventType, Value: []byte(proto.MessageName(msg))},
	}}
	if err := raw.ProduceSync(context.Background(), rec).FirstErr(); err != nil {
		t.Fatal(err)
	}
}

// Far from Colombo so the seeded fleet never competes with the test riders.
var (
	galle  = &commonv1.GeoPoint{Lat: 6.0535, Lng: 80.2210}
	kandy  = &commonv1.GeoPoint{Lat: 7.2906, Lng: 80.6337}
	jaffna = &commonv1.GeoPoint{Lat: 9.6615, Lng: 80.0255}
)

// onboard takes a new rider through the application flow and puts them online at p.
func onboard(t *testing.T, p *commonv1.GeoPoint) (riderID string, ctx context.Context) {
	t.Helper()
	user := "it-user-" + uuid.NewString()
	phone := fmt.Sprintf("+94 77 %07d", time.Now().UnixNano()%10_000_000)
	app := must(riders.SubmitRiderApplication(as(user, "customer"), &dispatchv1.SubmitRiderApplicationRequest{
		Name: "Test Rider", Phone: phone, City: "Galle", Vehicle: dispatchv1.VehicleType_VEHICLE_TYPE_MOTORBIKE,
		Documents: []*commonv1.PartnerDocument{{Kind: "licence", FileName: "l.jpg"}, {Kind: "nicFront", FileName: "n.jpg"}},
		Bank:      &commonv1.BankAccount{Bank: "HNB", AccountNumber: "0012345678"}, IdempotencyKey: "apply-" + user,
	})).Application
	if app.Bank.AccountNumber != "" || app.Bank.AccountLast4 != "5678" {
		t.Fatalf("bank leaked or not masked: %v", app.Bank)
	}
	if _, err := riders.DecideRiderApplication(opsCtx, &dispatchv1.DecideRiderApplicationRequest{
		ApplicationId: app.Id, Decision: commonv1.ApplicationStatus_APPLICATION_STATUS_APPROVED,
	}); apperr.Reason(err) != "DOCUMENTS_NOT_APPROVED" {
		t.Fatalf("approve with pending documents: %v", err)
	}
	for _, d := range app.Documents {
		must(riders.ReviewRiderDocument(opsCtx, &dispatchv1.ReviewRiderDocumentRequest{ApplicationId: app.Id, DocumentId: d.Id, Status: commonv1.DocumentStatus_DOCUMENT_STATUS_APPROVED}))
	}
	decided := must(riders.DecideRiderApplication(opsCtx, &dispatchv1.DecideRiderApplicationRequest{
		ApplicationId: app.Id, Decision: commonv1.ApplicationStatus_APPLICATION_STATUS_APPROVED, IdempotencyKey: "approve",
	})).Application
	if decided.RiderId == "" {
		t.Fatal("approval created no rider")
	}
	ctx = as(user, "rider")
	me := must(riders.GetMyRider(ctx, &dispatchv1.GetMyRiderRequest{})).Rider
	if me.Id != decided.RiderId || me.UserId != user || me.Status != dispatchv1.RiderStatus_RIDER_STATUS_OFFLINE {
		t.Fatalf("GetMyRider = %v", me)
	}
	on := must(jobs.SetAvailability(ctx, &dispatchv1.SetAvailabilityRequest{Online: true, Position: p}))
	if on.Rider.Status != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE || !on.CashAllowed {
		t.Fatalf("online = %v", on)
	}
	t.Cleanup(func() {
		_, _ = jobs.SetAvailability(ctx, &dispatchv1.SetAvailabilityRequest{Online: false})
	})
	return me.Id, ctx
}

func orderAt(p *commonv1.GeoPoint, pay commonv1.PaymentMethodKind) *orderv1.OrderAccepted {
	id := uuid.NewString()
	now := time.Now()
	return &orderv1.OrderAccepted{
		OrderId: id, ReadyBy: timestamppb.New(now.Add(10 * time.Minute)), OccurredAt: timestamppb.New(now),
		Order: &orderv1.Order{
			Id: id, OrderNumber: fmt.Sprintf("KD-IT%d", now.UnixNano()%100000), Mode: commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY,
			DeliveryCode: "4821", Customer: &commonv1.Contact{Id: "c-it", Name: "Dilini Fernando"},
			Restaurant: &orderv1.OrderRestaurant{Id: "r-it", Name: "Test Kottu", Area: "Fort", Location: &commonv1.GeoPoint{Lat: p.Lat + 0.005, Lng: p.Lng}},
			Address:    &commonv1.Address{Line: "1 Lighthouse St", Area: "Fort", Location: &commonv1.GeoPoint{Lat: p.Lat - 0.01, Lng: p.Lng + 0.01}},
			Lines:      []*orderv1.OrderLine{{Key: "a", Name: "Chicken kottu", Quantity: 2}, {Key: "b", Name: "Ginger beer", Quantity: 1}},
			Payment:    &commonv1.PaymentMethod{Kind: pay},
			Totals:     &orderv1.OrderTotals{Total: &commonv1.Money{AmountMinor: 234000, Currency: "LKR"}, Tip: &commonv1.Money{AmountMinor: 5000}},
		},
	}
}

func waitOffer(t *testing.T, ctx context.Context) *dispatchv1.DeliveryOffer {
	t.Helper()
	var offer *dispatchv1.DeliveryOffer
	eventually(t, 20*time.Second, "an offer", func() bool {
		r, err := jobs.GetCurrentOffer(ctx, &dispatchv1.GetCurrentOfferRequest{})
		offer = r.GetOffer()
		return err == nil && offer != nil
	})
	return offer
}

func outboxTypes(t *testing.T, aggregateID string) []string {
	t.Helper()
	rows, err := a.Pool.Query(context.Background(), `SELECT type FROM outbox WHERE aggregateid = $1 ORDER BY created_at, id`, aggregateID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		out = append(out, strings.TrimPrefix(s, "kade.dispatch.v1."))
	}
	return out
}

func TestHealth(t *testing.T) {
	resp, err := http.Get("http://" + a.HTTPAddr.String() + "/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var r struct{ Checks map[string]string }
	_ = json.Unmarshal(body, &r)
	if resp.StatusCode != 200 || r.Checks["postgres"] != "ok" || r.Checks["kafka"] != "ok" || r.Checks["redis"] != "ok" {
		t.Fatalf("ready = %d %s", resp.StatusCode, body)
	}
}

func TestSeededFleet(t *testing.T) {
	nimal := as(dispatch.NimalUserID, "rider")
	me := must(riders.GetMyRider(nimal, &dispatchv1.GetMyRiderRequest{})).Rider
	if me.Id != dispatch.NimalRiderID || me.Name != "Nimal Perera" || me.Vehicle.Plate != "WP BCD-4521" || me.Rating != 4.9 || me.Bank.AccountLast4 != "4417" {
		t.Fatalf("nimal = %v", me)
	}
	if _, err := riders.GetMyRider(as("nobody-"+uuid.NewString(), "rider"), &dispatchv1.GetMyRiderRequest{}); apperr.Reason(err) != "RIDER_NOT_FOUND" {
		t.Fatalf("unknown user: %v", err)
	}
	trips := must(jobs.ListTrips(nimal, &dispatchv1.ListTripsRequest{}))
	if len(trips.Trips) == 0 || trips.Trips[0].Pay.Total.AmountMinor <= 0 {
		t.Fatalf("nimal's history = %v", trips)
	}
	quests := must(jobs.ListQuests(nimal, &dispatchv1.ListQuestsRequest{}))
	if len(quests.Quests) != 3 {
		t.Fatalf("quests = %v", quests)
	}
	// Riders act only for themselves.
	if _, err := jobs.GetActiveJob(nimal, &dispatchv1.GetActiveJobRequest{RiderId: dispatch.SeedID("8001", 102)}); apperr.Reason(err) != "RIDER_MISMATCH" {
		t.Fatalf("acting for another rider: %v", err)
	}
	list := must(riders.ListRiders(opsCtx, &dispatchv1.ListRidersRequest{Query: "Kasun"}))
	if len(list.Riders) == 0 || list.Riders[0].Id != dispatch.SeedID("8001", 102) {
		t.Fatalf("search Kasun = %v", list.Riders)
	}
	online := must(riders.ListRiders(opsCtx, &dispatchv1.ListRidersRequest{Status: dispatchv1.RiderStatus_RIDER_STATUS_ONLINE, Page: &commonv1.PageRequest{PageSize: 100}}))
	if len(online.Riders) < 25 || online.Riders[0].Position == nil {
		t.Fatalf("online riders = %d (first %v)", len(online.Riders), online.Riders[0])
	}
	over := must(riders.ListRiders(opsCtx, &dispatchv1.ListRidersRequest{OverCashLimit: true}))
	if len(over.Riders) < 2 {
		t.Fatalf("over cash limit = %d", len(over.Riders))
	}
	if _, err := riders.ListRiders(nimal, &dispatchv1.ListRidersRequest{}); apperr.Reason(err) != "STAFF_ONLY" {
		t.Fatalf("rider listing the fleet: %v", err)
	}
	apps := must(riders.ListRiderApplications(opsCtx, &dispatchv1.ListRiderApplicationsRequest{Status: commonv1.ApplicationStatus_APPLICATION_STATUS_PENDING}))
	if len(apps.Applications) < 4 {
		t.Fatalf("pending applications = %d", len(apps.Applications))
	}
	snap := must(ops.GetLiveSnapshot(opsCtx, &dispatchv1.GetLiveSnapshotRequest{})).Snapshot
	if snap.RidersOnline < 25 || len(snap.Zones) != len(dispatch.Zones) || len(snap.Dots) == 0 {
		t.Fatalf("snapshot: online %d zones %d dots %d", snap.RidersOnline, len(snap.Zones), len(snap.Dots))
	}
}

// OrderAccepted → offer → decline → re-offer → accept → every step → delivered.
func TestDeliveryLifecycle(t *testing.T) {
	riderID, rctx := onboard(t, galle)
	evt := orderAt(galle, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH)
	publish(t, "kade.order.events", evt.OrderId, evt)

	offer := waitOffer(t, rctx)
	if offer.RiderId != riderID || offer.Delivery.OrderId != evt.OrderId || offer.Delivery.CashToCollect.AmountMinor != 234000 || offer.Delivery.Pay.Tip.AmountMinor != 5000 {
		t.Fatalf("offer = %v", offer)
	}
	must(jobs.DeclineOffer(rctx, &dispatchv1.DeclineOfferRequest{OfferId: offer.Id, Reason: "Too far"}))
	again := waitOffer(t, rctx) // REOFFER_AFTER is 1 s in this test
	if again.Id == offer.Id {
		t.Fatal("expected a new offer")
	}
	acc := must(jobs.AcceptOffer(rctx, &dispatchv1.AcceptOfferRequest{OfferId: again.Id, IdempotencyKey: "acc-1"})).Delivery
	if acc.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED || acc.RiderId != riderID {
		t.Fatalf("accepted = %v", acc)
	}
	if replay := must(jobs.AcceptOffer(rctx, &dispatchv1.AcceptOfferRequest{OfferId: again.Id, IdempotencyKey: "acc-1"})).Delivery; replay.Id != acc.Id {
		t.Fatal("idempotent accept returned another delivery")
	}
	if _, err := jobs.AcceptOffer(rctx, &dispatchv1.AcceptOfferRequest{OfferId: offer.Id}); apperr.Reason(err) != "OFFER_EXPIRED" {
		t.Fatalf("accepting the declined offer: %v", err)
	}
	if _, err := jobs.SetAvailability(rctx, &dispatchv1.SetAvailabilityRequest{Online: false}); apperr.Reason(err) != "RIDER_ON_JOB" {
		t.Fatalf("offline mid-job: %v", err)
	}
	active := must(jobs.GetActiveJob(rctx, &dispatchv1.GetActiveJobRequest{})).Delivery
	if active.GetId() != acc.Id {
		t.Fatalf("active job = %v", active)
	}

	id := acc.Id
	must(jobs.ArriveAtRestaurant(rctx, &dispatchv1.ArriveAtRestaurantRequest{DeliveryId: id}))
	ready := must(jobs.ReportFoodNotReady(rctx, &dispatchv1.ReportFoodNotReadyRequest{DeliveryId: id}))
	if !ready.ReadyAt.AsTime().After(time.Now()) {
		t.Errorf("ready at = %v", ready.ReadyAt.AsTime())
	}
	if _, err := jobs.ConfirmPickup(rctx, &dispatchv1.ConfirmPickupRequest{DeliveryId: id, CheckedItemIds: []string{"a"}}); apperr.Reason(err) != "ITEMS_NOT_CHECKED" {
		t.Fatalf("pickup with an item unticked: %v", err)
	}
	picked := must(jobs.ConfirmPickup(rctx, &dispatchv1.ConfirmPickupRequest{DeliveryId: id, CheckedItemIds: []string{"a", "b"}})).Delivery
	if picked.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_PICKED_UP {
		t.Fatalf("picked = %v", picked.Status)
	}
	must(jobs.SendCustomerMessage(rctx, &dispatchv1.SendCustomerMessageRequest{DeliveryId: id, Text: "I'm outside"}))
	must(jobs.ArriveAtCustomer(rctx, &dispatchv1.ArriveAtCustomerRequest{DeliveryId: id}))
	if _, err := jobs.CompleteDelivery(rctx, &dispatchv1.CompleteDeliveryRequest{DeliveryId: id, Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "1111",
		CashCollected: &commonv1.Money{AmountMinor: 234000}}); apperr.Reason(err) != "DELIVERY_CODE_MISMATCH" {
		t.Fatalf("wrong code: %v", err)
	}
	if _, err := jobs.CompleteDelivery(rctx, &dispatchv1.CompleteDeliveryRequest{DeliveryId: id, Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "4821",
		CashCollected: &commonv1.Money{AmountMinor: 100000}}); apperr.Reason(err) != "CASH_SHORT" {
		t.Fatalf("cash short: %v", err)
	}
	trip := must(jobs.CompleteDelivery(rctx, &dispatchv1.CompleteDeliveryRequest{DeliveryId: id, Proof: dispatchv1.ProofKind_PROOF_KIND_CODE, Code: "4821",
		CashCollected: &commonv1.Money{AmountMinor: 500000}, IdempotencyKey: "done"})).Trip
	if trip.Id != id || trip.CashCollected.AmountMinor != 500000 || trip.Proof != dispatchv1.ProofKind_PROOF_KIND_CODE || trip.Pay.Total.AmountMinor <= 0 {
		t.Fatalf("trip = %v", trip)
	}
	if got := must(jobs.GetTrip(rctx, &dispatchv1.GetTripRequest{TripId: id})).Trip; got.Id != id {
		t.Fatalf("GetTrip = %v", got)
	}
	me := must(riders.GetMyRider(rctx, &dispatchv1.GetMyRiderRequest{})).Rider
	if me.Status != dispatchv1.RiderStatus_RIDER_STATUS_ONLINE || me.TripsWeek != 1 {
		t.Fatalf("rider after delivery = %v", me)
	}
	full := must(ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId}))
	if full.Delivery.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED || len(full.Offers) != 2 ||
		full.Offers[0].Status != dispatchv1.OfferStatus_OFFER_STATUS_DECLINED || full.Offers[1].Status != dispatchv1.OfferStatus_OFFER_STATUS_ACCEPTED {
		t.Fatalf("delivery with offers = %v", full)
	}
	want := []string{"DeliveryRequested", "DeliveryOfferSent", "DeliveryOfferDeclined", "DeliveryOfferSent", "RiderAssigned",
		"RiderArrivedAtRestaurant", "DeliveryPickedUp", "RiderArrivedAtCustomer", "DeliveryCompleted"}
	if got := outboxTypes(t, id); !slices.Equal(got, want) {
		t.Fatalf("delivery events = %v\nwant %v", got, want)
	}
	if got := outboxTypes(t, riderID); !slices.Contains(got, "RiderStatusChanged") {
		t.Fatalf("rider events = %v", got)
	}
}

// An unanswered offer expires after OFFER_TIMEOUT and goes out again; cancelling the order
// withdraws it.
func TestOfferExpiryAndCancellation(t *testing.T) {
	_, rctx := onboard(t, kandy)
	evt := orderAt(kandy, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD)
	publish(t, "kade.order.events", evt.OrderId, evt)
	first := waitOffer(t, rctx)
	eventually(t, 15*time.Second, "offer expiry", func() bool {
		r, _ := ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId})
		return len(r.GetOffers()) > 0 && r.GetOffers()[0].Status == dispatchv1.OfferStatus_OFFER_STATUS_EXPIRED
	})
	if _, err := jobs.AcceptOffer(rctx, &dispatchv1.AcceptOfferRequest{OfferId: first.Id}); apperr.Reason(err) != "OFFER_EXPIRED" {
		t.Fatalf("late accept: %v", err)
	}
	publish(t, "kade.order.events", evt.OrderId, &orderv1.OrderCancelled{OrderId: evt.OrderId, Order: evt.Order,
		Cancellation: &orderv1.Cancellation{Reason: "Customer changed their mind"}, OccurredAt: timestamppb.Now()})
	eventually(t, 15*time.Second, "delivery cancelled", func() bool {
		r, _ := ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId})
		return r.GetDelivery().GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_CANCELLED
	})
	d := must(ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId}))
	types := outboxTypes(t, d.Delivery.Id)
	if !slices.Contains(types, "DeliveryOfferExpired") || types[len(types)-1] != "DeliveryCancelled" {
		t.Fatalf("events = %v", types)
	}
	if r, _ := jobs.GetCurrentOffer(rctx, &dispatchv1.GetCurrentOfferRequest{}); r.GetOffer() != nil {
		t.Fatalf("offer still open after cancel: %v", r.GetOffer())
	}
}

// Over the cash limit (ledger) → no cash orders; nobody else nearby → UNMATCHED and ops are told.
// Ops then assign the rider by hand.
func TestCashLimitUnmatchedAndReassign(t *testing.T) {
	riderID, rctx := onboard(t, jaffna)
	publish(t, "kade.ledger.events", riderID, &ledgerv1.RiderCashBalanceChanged{RiderId: riderID, OccurredAt: timestamppb.Now(),
		Balance: &ledgerv1.RiderCashBalance{RiderId: riderID, Holding: &commonv1.Money{AmountMinor: 2_145_000}, Limit: &commonv1.Money{AmountMinor: 1_500_000}, OverLimit: true}})
	eventually(t, 15*time.Second, "cash limit applied", func() bool {
		r, _ := riders.GetMyRider(rctx, &dispatchv1.GetMyRiderRequest{})
		return r.GetRider() != nil && !r.GetRider().CashAllowed
	})
	evt := orderAt(jaffna, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CASH)
	publish(t, "kade.order.events", evt.OrderId, evt)
	eventually(t, 40*time.Second, "unmatched", func() bool {
		r, _ := ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId})
		return r.GetDelivery().GetStatus() == dispatchv1.DeliveryStatus_DELIVERY_STATUS_UNMATCHED
	})
	if r, _ := jobs.GetCurrentOffer(rctx, &dispatchv1.GetCurrentOfferRequest{}); r.GetOffer() != nil {
		t.Fatal("a rider over the cash limit got a cash order")
	}
	d := must(ops.GetDelivery(opsCtx, &dispatchv1.GetDeliveryRequest{OrderId: evt.OrderId})).Delivery
	if types := outboxTypes(t, d.Id); !slices.Contains(types, "DeliveryMatchingFailed") || slices.Contains(types, "DeliveryOfferSent") {
		t.Fatalf("events = %v", types)
	}
	snap := must(ops.GetLiveSnapshot(opsCtx, &dispatchv1.GetLiveSnapshotRequest{})).Snapshot
	if !slices.ContainsFunc(snap.Attention, func(a *dispatchv1.AttentionItem) bool { return a.RecordId == evt.OrderId }) {
		t.Fatal("unmatched delivery missing from the ops attention list")
	}
	re := must(ops.ReassignRider(opsCtx, &dispatchv1.ReassignRiderRequest{OrderId: evt.OrderId, RiderId: riderID, Reason: "Manual", By: "Ops", IdempotencyKey: "r1"})).Delivery
	if re.Status != dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED || re.RiderId != riderID {
		t.Fatalf("reassigned = %v", re)
	}
	if types := outboxTypes(t, d.Id); types[len(types)-1] != "RiderAssigned" {
		t.Fatalf("events = %v", types)
	}
}

// A ping on kade.rider.locations (Confluent framing, as location produces it) moves an available
// rider in the GEO index.
func TestLocationStreamMovesAvailableRider(t *testing.T) {
	riderID, _ := onboard(t, &commonv1.GeoPoint{Lat: 8.3114, Lng: 80.4037}) // Anuradhapura
	var h sr.ConfluentHeader
	prefix, _ := h.AppendEncode(nil, 1, []int{0})
	target := &commonv1.GeoPoint{Lat: 8.3200, Lng: 80.4100}
	seq := int64(0)
	eventually(t, 30*time.Second, "position moved by the stream", func() bool {
		seq++
		b, _ := proto.Marshal(&locationv1.RiderLocation{RiderId: riderID, Position: target, Sequence: seq, ReceivedAt: timestamppb.Now()})
		_ = raw.ProduceSync(context.Background(), &kgo.Record{Topic: "kade.rider.locations", Key: []byte(riderID), Value: append(append([]byte(nil), prefix...), b...)}).FirstErr()
		time.Sleep(500 * time.Millisecond)
		pos, err := a.Redis.GeoPos(context.Background(), dispatch.KeyAvailable, riderID).Result()
		return err == nil && len(pos) == 1 && pos[0] != nil && dispatch.HaversineKm(pos[0].Latitude, pos[0].Longitude, target.Lat, target.Lng) < 0.05
	})
}

// The real relay: outbox row → Debezium → kade.delivery.events. Needs the connector:
// deploy/compose/connect/register-outbox.sh dispatch dispatch
func TestOutboxRelay(t *testing.T) {
	resp, err := http.Get(st.ConnectURL + "/connectors/outbox-dispatch/status")
	if err != nil {
		t.Skipf("Kafka Connect unreachable: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), `"state":"RUNNING"`) {
		t.Skipf("outbox-dispatch connector not running (%d): run register-outbox.sh dispatch dispatch", resp.StatusCode)
	}
	cl, err := kgo.NewClient(kgo.SeedBrokers(st.Brokers...), kgo.ConsumeTopics("kade.delivery.events"), kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd()))
	if err != nil {
		t.Fatal(err)
	}
	defer cl.Close()
	pctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	cl.PollFetches(pctx)
	cancel()

	evt := orderAt(&commonv1.GeoPoint{Lat: 5.9485, Lng: 80.5353}, commonv1.PaymentMethodKind_PAYMENT_METHOD_KIND_CARD) // Matara: no riders
	publish(t, "kade.order.events", evt.OrderId, evt)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	for ctx.Err() == nil {
		for _, r := range cl.PollFetches(ctx).Records() {
			if kafka.Header(r, kafka.HeaderEventType) != "kade.dispatch.v1.DeliveryRequested" {
				continue
			}
			var e dispatchv1.DeliveryRequested
			if proto.Unmarshal(r.Value, &e) == nil && e.OrderId == evt.OrderId && string(r.Key) == e.DeliveryId {
				return
			}
		}
	}
	t.Fatal("DeliveryRequested never reached kade.delivery.events")
}
