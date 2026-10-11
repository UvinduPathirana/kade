package fanout

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	merchantv1 "github.com/UvinduPathirana/kade/gen/go/kade/merchant/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
	"github.com/UvinduPathirana/kade/services/realtime/internal/views"
)

const (
	orderID    = "00000000-0000-7000-8003-000000004821"
	customerID = "00000000-0000-7000-8005-000000000001"
	outletID   = "00000000-0000-7000-8000-000000000001"
	riderID    = "00000000-0000-7000-8001-000000000101"
	deliveryID = "00000000-0000-7000-8020-000000004821"
)

type pushed struct {
	ch     string
	msg    *realtimev1.RealtimeMessage
	replay bool
}

type capture struct {
	mu  sync.Mutex
	all []pushed
}

func (c *capture) Publish(_ context.Context, ch string, m *realtimev1.RealtimeMessage, replay bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	m.Channel = ch
	c.all = append(c.all, pushed{ch, proto.Clone(m).(*realtimev1.RealtimeMessage), replay})
	return nil
}

// take returns and clears what was pushed.
func (c *capture) take() []pushed {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := c.all
	c.all = nil
	return out
}

func on(ps []pushed, ch string) []*realtimev1.RealtimeMessage {
	var out []*realtimev1.RealtimeMessage
	for _, p := range ps {
		if p.ch == ch {
			out = append(out, p.msg)
		}
	}
	return out
}

type env struct {
	t      *testing.T
	s      *Service
	v      *views.Store
	pub    *capture
	router *kafka.Router
	mr     *miniredis.Miniredis
	now    time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	e := &env{t: t, pub: &capture{}, mr: mr, now: time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)}
	e.v = views.New(rdb, "rt:", time.Hour)
	e.s = New(Options{Views: e.v, Publisher: e.pub, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now: func() time.Time { return e.now }, PositionInterval: time.Second})
	e.router = kafka.NewRouter()
	e.s.Register(e.router)
	return e
}

func (e *env) ts(offset time.Duration) *timestamppb.Timestamp {
	return timestamppb.New(e.now.Add(offset))
}

// send handles an event as the consumer would and returns the frames it produced.
func (e *env) send(msg proto.Message) []pushed {
	e.t.Helper()
	rec, err := kafka.NewRecord("kade.test.events", "k", uuid.New(), msg)
	if err != nil {
		e.t.Fatal(err)
	}
	handled, err := e.router.HandleRecord(context.Background(), rec)
	if err != nil || !handled {
		e.t.Fatalf("%s: handled=%v err=%v", proto.MessageName(msg), handled, err)
	}
	return e.pub.take()
}

func (e *env) order(status orderv1.OrderStatus) *orderv1.Order {
	return &orderv1.Order{
		Id: orderID, OrderNumber: "KD-4821", Status: status, Mode: commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY,
		Customer:   &commonv1.Contact{Id: customerID, Name: "Dilini Perera", Phone: "+94771234567"},
		Restaurant: &orderv1.OrderRestaurant{Id: outletID, Name: "Galle Road Kottu House", Phone: "+94112345678"},
		Lines:      []*orderv1.OrderLine{{ItemId: "i1", Name: "Chicken kottu", Quantity: 2, ChoiceNames: []string{"Hot"}}},
		Notes:      []*orderv1.OrderNote{{Id: "n1", Body: "VIP, ops only"}},
		Totals:     &orderv1.OrderTotals{Subtotal: &commonv1.Money{AmountMinor: 230000, Currency: "LKR"}},
		PlacedAt:   e.ts(-time.Minute),
		DueAt:      e.ts(40 * time.Minute),
	}
}

func TestOrderPlacedPushesToCustomerAndKitchen(t *testing.T) {
	e := newEnv(t)
	ps := e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(0)})

	tracking := on(ps, "order:"+orderID)
	if len(tracking) != 1 || len(on(ps, "customer:"+customerID)) != 1 {
		t.Fatalf("want one frame on order: and customer:, got %v", ps)
	}
	o := tracking[0].GetOrder().GetOrder()
	if o.GetStatus() != orderv1.OrderStatus_ORDER_STATUS_PLACED || tracking[0].GetSourceType() != "kade.order.v1.OrderPlaced" || tracking[0].GetId() == "" {
		t.Fatalf("bad order frame: %v", tracking[0])
	}
	if len(o.GetNotes()) != 0 || o.GetCustomer().GetPhone() != "" || o.GetRestaurant().GetPhone() != "" {
		t.Fatalf("ops-only fields leaked: %v", o)
	}
	kitchen := on(ps, "outlet:"+outletID)
	if len(kitchen) != 1 {
		t.Fatalf("want one kitchen frame, got %v", ps)
	}
	tk := kitchen[0].GetKitchenTicket()
	if !tk.GetIsNew() || tk.GetTicket().GetStatus() != merchantv1.TicketStatus_TICKET_STATUS_NEW || tk.GetTicket().GetTicketNumber() != "4821" ||
		tk.GetTicket().GetCustomerFirstName() != "Dilini" || len(tk.GetTicket().GetLines()) != 1 {
		t.Fatalf("bad ticket: %v", tk)
	}
	acc, ok, _ := e.v.OrderAccess(context.Background(), orderID)
	if !ok || acc.CustomerID != customerID || acc.OutletID != outletID {
		t.Fatalf("ownership not recorded: %+v", acc)
	}
}

func TestScheduledOrderHasNoTicketUntilReleased(t *testing.T) {
	e := newEnv(t)
	ps := e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_SCHEDULED), OccurredAt: e.ts(0)})
	if len(on(ps, "outlet:"+outletID)) != 0 || len(on(ps, "order:"+orderID)) != 1 {
		t.Fatalf("scheduled: %v", ps)
	}
	ps = e.send(&orderv1.OrderReleasedToKitchen{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(time.Second)})
	if k := on(ps, "outlet:"+outletID); len(k) != 1 || !k[0].GetKitchenTicket().GetIsNew() {
		t.Fatalf("released: %v", ps)
	}
}

func TestProgressEventsAndNoRegression(t *testing.T) {
	e := newEnv(t)
	e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(0)})
	ps := e.send(&orderv1.OrderReady{OrderId: orderID, OrderNumber: "KD-4821", CustomerId: customerID, RestaurantId: outletID, OccurredAt: e.ts(10 * time.Minute)})
	if o := on(ps, "order:"+orderID); len(o) != 1 || o[0].GetOrder().GetOrder().GetStatus() != orderv1.OrderStatus_ORDER_STATUS_READY ||
		o[0].GetOrder().GetOrder().GetRestaurant().GetName() != "Galle Road Kottu House" {
		t.Fatalf("ready should patch the stored snapshot: %v", ps)
	}
	if k := on(ps, "outlet:"+outletID); len(k) != 1 || k[0].GetKitchenTicket().GetTicket().GetStatus() != merchantv1.TicketStatus_TICKET_STATUS_READY {
		t.Fatalf("ticket not ready: %v", ps)
	}
	// A late OrderAccepted snapshot (other partition) must not move the order back.
	ps = e.send(&orderv1.OrderAccepted{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_ACCEPTED), OccurredAt: e.ts(time.Minute)})
	if len(ps) != 0 {
		t.Fatalf("stale snapshot pushed: %v", ps)
	}
	o, _, _ := e.v.Order(context.Background(), orderID)
	if o.GetStatus() != orderv1.OrderStatus_ORDER_STATUS_READY {
		t.Fatalf("status regressed to %v", o.GetStatus())
	}
}

func TestMerchantTicketEvents(t *testing.T) {
	e := newEnv(t)
	e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(0)})
	ps := e.send(&merchantv1.TicketAccepted{OutletId: outletID, OrderId: orderID, OrderNumber: "KD-4821", PrepMinutes: 15, ReadyBy: e.ts(15 * time.Minute), OccurredAt: e.ts(time.Minute)})
	k := on(ps, "outlet:"+outletID)
	if len(k) != 1 || k[0].GetKitchenTicket().GetTicket().GetStatus() != merchantv1.TicketStatus_TICKET_STATUS_PREPARING ||
		k[0].GetKitchenTicket().GetTicket().GetPrepMinutes() != 15 || len(k[0].GetKitchenTicket().GetTicket().GetLines()) != 1 {
		t.Fatalf("accepted ticket: %v", ps)
	}
	ps = e.send(&merchantv1.TicketRejected{OutletId: outletID, OrderId: "other", OrderNumber: "KD-9", Reason: orderv1.RejectionReason_REJECTION_REASON_TIMEOUT, OccurredAt: e.ts(0)})
	if k := on(ps, "outlet:"+outletID); len(k) != 1 || k[0].GetKitchenTicket().GetTicket().GetStatus() != merchantv1.TicketStatus_TICKET_STATUS_MISSED {
		t.Fatalf("timeout should be missed: %v", ps)
	}
}

func TestDeliveryFlow(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(0)})
	e.send(&dispatchv1.DeliveryRequested{DeliveryId: deliveryID, OrderId: orderID, OccurredAt: e.ts(0),
		Delivery: &dispatchv1.Delivery{Id: deliveryID, OrderId: orderID, OrderNumber: "KD-4821", Status: dispatchv1.DeliveryStatus_DELIVERY_STATUS_MATCHING}})

	offer := &dispatchv1.DeliveryOffer{Id: "offer-1", DeliveryId: deliveryID, RiderId: riderID, ExpiresAt: e.ts(30 * time.Second)}
	ps := e.send(&dispatchv1.DeliveryOfferSent{DeliveryId: deliveryID, OrderId: orderID, Offer: offer, OccurredAt: e.ts(0)})
	if r := on(ps, "rider:"+riderID); len(r) != 1 || r[0].GetRiderOffer().GetOffer().GetId() != "offer-1" {
		t.Fatalf("offer: %v", ps)
	}
	// An expiry for an older offer doesn't clear the current one.
	if ps := e.send(&dispatchv1.DeliveryOfferExpired{DeliveryId: deliveryID, OrderId: orderID, OfferId: "offer-0", RiderId: riderID, OccurredAt: e.ts(0)}); len(ps) != 0 {
		t.Fatalf("stale expiry pushed: %v", ps)
	}

	ps = e.send(&dispatchv1.RiderAssigned{DeliveryId: deliveryID, OrderId: orderID, OrderNumber: "KD-4821", RestaurantId: outletID,
		Rider: &dispatchv1.RiderCard{RiderId: riderID, Name: "Nimal Silva", Phone: "+94770000000", MaskedPhone: "+94 11 000 0000"}, OccurredAt: e.ts(5 * time.Second)})
	job := on(ps, "rider:"+riderID)
	if len(job) != 1 || job[0].GetRiderJob().GetDelivery().GetRiderId() != riderID || job[0].GetRiderJob().GetDelivery().GetStatus() != dispatchv1.DeliveryStatus_DELIVERY_STATUS_ASSIGNED {
		t.Fatalf("job: %v", ps)
	}
	tracking := on(ps, "order:"+orderID)
	if len(tracking) != 1 || tracking[0].GetOrder().GetOrder().GetRider().GetName() != "Nimal Silva" || tracking[0].GetOrder().GetOrder().GetRider().GetPhone() != "" {
		t.Fatalf("tracking should show the rider without the real phone: %v", ps)
	}
	if k := on(ps, "outlet:"+outletID); len(k) != 1 || k[0].GetKitchenTicket().GetTicket().GetRider().GetRiderId() != riderID {
		t.Fatalf("kitchen should see the rider: %v", ps)
	}
	if acc, _, _ := e.v.OrderAccess(ctx, orderID); acc.RiderID != riderID {
		t.Fatalf("rider may not watch the order: %+v", acc)
	}

	// Food ready → rider notice.
	ps = e.send(&orderv1.OrderReady{OrderId: orderID, OrderNumber: "KD-4821", CustomerId: customerID, RestaurantId: outletID, OccurredAt: e.ts(10 * time.Minute)})
	if r := on(ps, "rider:"+riderID); len(r) != 1 || r[0].GetRiderJob().GetNotice() != "Food is ready" {
		t.Fatalf("food ready notice: %v", ps)
	}
	ps = e.send(&dispatchv1.RiderArrivedAtRestaurant{DeliveryId: deliveryID, OrderId: orderID, RestaurantId: outletID, RiderId: riderID, OccurredAt: e.ts(11 * time.Minute)})
	if k := on(ps, "outlet:"+outletID); len(k) != 1 || !k[0].GetKitchenTicket().GetTicket().GetRiderAtCounter() {
		t.Fatalf("rider at counter: %v", ps)
	}

	// Reassignment: the old rider loses the job and order access.
	ps = e.send(&dispatchv1.RiderUnassigned{DeliveryId: deliveryID, OrderId: orderID, RiderId: riderID, OccurredAt: e.ts(12 * time.Minute)})
	if r := on(ps, "rider:"+riderID); len(r) != 1 || r[0].GetRiderJob().GetNotice() != "Job reassigned" || r[0].GetRiderJob().GetDelivery().GetRiderId() != "" {
		t.Fatalf("unassigned: %v", ps)
	}
	if acc, _, _ := e.v.OrderAccess(ctx, orderID); acc.RiderID != "" {
		t.Fatalf("old rider still has access: %+v", acc)
	}
}

func TestOfferWithdrawnWhenAnotherRiderGetsTheJob(t *testing.T) {
	e := newEnv(t)
	other := "00000000-0000-7000-8001-000000000102"
	e.send(&dispatchv1.DeliveryOfferSent{DeliveryId: deliveryID, OrderId: orderID, Offer: &dispatchv1.DeliveryOffer{Id: "o1", DeliveryId: deliveryID, RiderId: other}, OccurredAt: e.ts(0)})
	ps := e.send(&dispatchv1.RiderAssigned{DeliveryId: deliveryID, OrderId: orderID, Rider: &dispatchv1.RiderCard{RiderId: riderID}, Reassigned: true, OccurredAt: e.ts(time.Second)})
	w := on(ps, "rider:"+other)
	if len(w) != 1 || w[0].GetRiderOffer() == nil || w[0].GetRiderOffer().GetOffer() != nil {
		t.Fatalf("other rider's offer should be withdrawn (offer unset): %v", ps)
	}
}

func TestStaleEventsUpdateViewsWithoutPushing(t *testing.T) {
	e := newEnv(t)
	ps := e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(-2 * time.Hour)})
	if len(ps) != 0 {
		t.Fatalf("stale event pushed: %v", ps)
	}
	if _, ok, _ := e.v.OrderAccess(context.Background(), orderID); !ok {
		t.Fatal("stale event must still build the ownership index")
	}
}

func locationRecord(t *testing.T, loc *locationv1.RiderLocation) *kgo.Record {
	t.Helper()
	b, err := proto.Marshal(loc)
	if err != nil {
		t.Fatal(err)
	}
	var h sr.ConfluentHeader
	framed, err := h.AppendEncode(nil, 7, []int{0})
	if err != nil {
		t.Fatal(err)
	}
	return &kgo.Record{Topic: "kade.rider.locations", Key: []byte(loc.GetRiderId()), Value: append(framed, b...)}
}

func TestRiderPositionsAreThrottledAndOrdered(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	fix := func(seq int64) *locationv1.RiderLocation {
		return &locationv1.RiderLocation{RiderId: riderID, OrderId: orderID, Sequence: seq, ReceivedAt: e.ts(0),
			Position: &commonv1.GeoPoint{Lat: 6.9, Lng: 79.85}, Activity: locationv1.RiderActivity_RIDER_ACTIVITY_TO_CUSTOMER}
	}
	if err := e.s.HandleLocation(ctx, locationRecord(t, fix(10))); err != nil {
		t.Fatal(err)
	}
	ps := e.pub.take()
	if p := on(ps, "order:"+orderID); len(p) != 1 || p[0].GetRiderPosition().GetLocation().GetSequence() != 10 || p[0].GetRiderPosition().GetOrderId() != orderID {
		t.Fatalf("position to order: %v", ps)
	}
	if p := on(ps, "ops:live"); len(p) != 1 || p[0].GetOpsLive().GetSnapshot().GetDots()[0].GetId() != riderID {
		t.Fatalf("rider dot to ops: %v", ps)
	}
	// Same second: throttled. Older sequence: dropped.
	_ = e.s.HandleLocation(ctx, locationRecord(t, fix(11)))
	_ = e.s.HandleLocation(ctx, locationRecord(t, fix(9)))
	if ps := e.pub.take(); len(ps) != 0 {
		t.Fatalf("throttle/ordering failed: %v", ps)
	}
	e.mr.FastForward(1100 * time.Millisecond)
	_ = e.s.HandleLocation(ctx, locationRecord(t, fix(9))) // still older than 11
	_ = e.s.HandleLocation(ctx, locationRecord(t, fix(12)))
	if ps := e.pub.take(); len(on(ps, "order:"+orderID)) != 1 || on(ps, "order:"+orderID)[0].GetRiderPosition().GetLocation().GetSequence() != 12 {
		t.Fatalf("after the interval: %v", ps)
	}
	// A fix older than 30 s is not drawn.
	old := fix(20)
	old.ReceivedAt = e.ts(-time.Minute)
	e.mr.FastForward(2 * time.Second)
	_ = e.s.HandleLocation(ctx, locationRecord(t, old))
	if ps := e.pub.take(); len(ps) != 0 {
		t.Fatalf("old fix pushed: %v", ps)
	}
	if err := e.s.HandleLocation(ctx, &kgo.Record{Value: []byte{9, 9}}); err == nil {
		t.Fatal("garbage should be an error (skipped by the consumer)")
	}
}

func TestOpsCounters(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	e.send(&orderv1.OrderPlaced{OrderId: orderID, Order: e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED), OccurredAt: e.ts(0)})
	second := e.order(orderv1.OrderStatus_ORDER_STATUS_PLACED)
	second.Id = "o2"
	second.DueAt = e.ts(-time.Minute) // already late
	e.send(&orderv1.OrderPlaced{OrderId: "o2", Order: second, OccurredAt: e.ts(0)})
	cancelled := e.order(orderv1.OrderStatus_ORDER_STATUS_CANCELLED)
	e.send(&orderv1.OrderCancelled{OrderId: orderID, Order: cancelled, OccurredAt: e.ts(time.Minute)})
	e.send(&dispatchv1.DeliveryRequested{DeliveryId: "d2", OrderId: "o2", OccurredAt: e.ts(0)})
	e.send(&dispatchv1.RiderStatusChanged{RiderId: riderID, Status: dispatchv1.RiderStatus_RIDER_STATUS_ONLINE, OccurredAt: e.ts(0)})
	e.send(&dispatchv1.DeliveryMatchingFailed{DeliveryId: "d2", OrderId: "o2", Attempts: 3, OccurredAt: e.ts(0)})

	if err := e.s.PublishOps(ctx, false); err != nil {
		t.Fatal(err)
	}
	ps := on(e.pub.take(), "ops:live")
	if len(ps) != 1 || ps[0].GetSourceType() != OpsSourceType {
		t.Fatalf("ops frame: %v", ps)
	}
	snap := ps[0].GetOpsLive().GetSnapshot()
	if snap.GetOrdersToday() != 2 || snap.GetInProgress() != 1 || snap.GetCancellationsToday() != 1 || snap.GetLate() != 1 ||
		snap.GetWaitingForRider() != 1 || snap.GetRidersOnline() != 1 || len(snap.GetAttention()) != 1 ||
		snap.GetAttention()[0].GetKind() != dispatchv1.AttentionKind_ATTENTION_KIND_UNMATCHED_DELIVERY {
		t.Fatalf("counters: %v", snap)
	}
	// Nothing changed since: no frame.
	_ = e.s.PublishOps(ctx, false)
	if ps := e.pub.take(); len(ps) != 0 {
		t.Fatalf("unchanged counters published: %v", ps)
	}
}

func TestGroupAndSupportOwnership(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	ps := e.send(&orderv1.GroupOrderUpdated{GroupId: "g1", Group: &orderv1.GroupOrder{Id: "g1", HostCustomerId: customerID,
		Members: []*orderv1.GroupMember{{Id: "m1", CustomerId: "c2"}, {Id: "m2"}}}, OccurredAt: e.ts(0)})
	if len(on(ps, "group:g1")) != 1 {
		t.Fatalf("group frame: %v", ps)
	}
	members, _ := e.v.GroupMembers(ctx, "g1")
	if len(members) != 2 {
		t.Fatalf("members = %v", members)
	}
}
