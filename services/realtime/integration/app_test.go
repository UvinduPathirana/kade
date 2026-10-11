//go:build integration

package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	merchantv1 "github.com/UvinduPathirana/kade/gen/go/kade/merchant/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	realtimev1 "github.com/UvinduPathirana/kade/gen/go/kade/realtime/v1"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/realtime/internal/app"
	"github.com/UvinduPathirana/kade/services/realtime/internal/config"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/kafka"
)

const (
	eventsTopic    = "kade.note.events" // stands in for every kade.<aggregate>.events topic
	locationsTopic = "kade.note.views"  // stands in for kade.rider.locations
)

var (
	st  stack
	a   *app.App
	raw *kgo.Client // test producer
	ws  string      // ws://host:port/ws
)

func TestMain(m *testing.M) {
	st = resolveStack()
	fmt.Printf("integration: using shared stack via %s\n", st.Where)
	cfg, err := config.Load(func(k string) string {
		return map[string]string{
			"SERVICE_NAME": "realtime-it", "HTTP_PORT": "1", "KAFKA_BROKERS": strings.Join(st.Brokers, ","), "REDIS_URL": st.RedisURL,
			// Own consumer group and Redis namespace, so a running realtime container is unaffected.
			"KAFKA_GROUP": "realtime-it", "REDIS_PREFIX": "rtit:", "LOG_LEVEL": "warn",
			// Test events go to the template topics, never to the real ones: merchant, dispatch,
			// notification… would otherwise act on these fake orders and riders. realtime routes by
			// the eventType header, so the topic name doesn't matter to it.
			"CONSUME_TOPICS": eventsTopic + "," + locationsTopic, "LOCATIONS_TOPIC": locationsTopic,
			"POSITION_MIN_INTERVAL": "500ms", "OPS_PUSH_INTERVAL": "200ms", "SHUTDOWN_TIMEOUT": "10s",
		}[k]
	})
	if err != nil {
		panic(err)
	}
	cfg.HTTPPort = 0 // random free port
	ctx, cancel := context.WithCancel(context.Background())
	if a, err = app.New(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "app.New:", err)
		os.Exit(1)
	}
	runErr := make(chan error, 1)
	go func() { runErr <- a.Run(ctx) }()
	ws = "ws://" + a.HTTPAddr.String() + "/ws"
	if raw, err = kgo.NewClient(kgo.SeedBrokers(st.Brokers...)); err != nil {
		panic(err)
	}

	code := m.Run()

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

// ---------- helpers ----------

type sock struct {
	t *testing.T
	c *websocket.Conn
}

func connect(t *testing.T, hdr map[string]string) *sock {
	t.Helper()
	h := http.Header{}
	for k, v := range hdr {
		h.Set(k, v)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, ws, &websocket.DialOptions{HTTPHeader: h})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return &sock{t, c}
}

func (s *sock) subscribe(channels ...string) *realtimev1.SubscribeResult {
	s.t.Helper()
	b, _ := protojson.Marshal(&realtimev1.ClientFrame{Frame: &realtimev1.ClientFrame_Subscribe{Subscribe: &realtimev1.Subscribe{Channels: channels}}})
	if err := s.c.Write(context.Background(), websocket.MessageText, b); err != nil {
		s.t.Fatal(err)
	}
	for {
		f := s.next(5 * time.Second)
		if f.GetSubscribed() != nil {
			return f.GetSubscribed()
		}
	}
}

func (s *sock) next(timeout time.Duration) *realtimev1.ServerFrame {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	_, b, err := s.c.Read(ctx)
	if err != nil {
		s.t.Fatalf("read: %v", err)
	}
	var f realtimev1.ServerFrame
	if err := protojson.Unmarshal(b, &f); err != nil {
		s.t.Fatalf("bad frame %s: %v", b, err)
	}
	return &f
}

// waitMessage reads until a message on ch satisfies ok.
func (s *sock) waitMessage(ch string, timeout time.Duration, ok func(*realtimev1.RealtimeMessage) bool) *realtimev1.RealtimeMessage {
	s.t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		left := time.Until(deadline)
		if left <= 0 {
			s.t.Fatalf("no matching message on %s within %v", ch, timeout)
		}
		f := s.next(left)
		if m := f.GetMessage(); m != nil && m.GetChannel() == ch && ok(m) {
			return m
		}
	}
}

// silent asserts nothing arrives for d.
func (s *sock) silent(d time.Duration) {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	defer cancel()
	if _, b, err := s.c.Read(ctx); err == nil {
		s.t.Fatalf("unexpected frame: %s", b)
	}
}

func produce(t *testing.T, key string, msg proto.Message) {
	t.Helper()
	rec, err := kafka.NewRecord(eventsTopic, key, uuid.New(), msg)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := raw.ProduceSync(ctx, rec).FirstErr(); err != nil {
		t.Fatal(err)
	}
}

func produceLocation(t *testing.T, loc *locationv1.RiderLocation) {
	t.Helper()
	b, _ := proto.Marshal(loc)
	var h sr.ConfluentHeader
	framed, _ := h.AppendEncode(nil, 1, []int{0}) // Confluent framing; realtime doesn't look the schema up
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := raw.ProduceSync(ctx, &kgo.Record{Topic: locationsTopic, Key: []byte(loc.GetRiderId()), Value: append(framed, b...)}).FirstErr(); err != nil {
		t.Fatal(err)
	}
}

func ident(user, roles string, extra ...string) map[string]string {
	m := map[string]string{"X-User-Id": user, "X-Roles": roles}
	for i := 0; i+1 < len(extra); i += 2 {
		m[extra[i]] = extra[i+1]
	}
	return m
}

// ---------- tests ----------

func TestHealthAndMetrics(t *testing.T) {
	resp, err := http.Get("http://" + a.HTTPAddr.String() + "/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var r struct{ Checks map[string]string }
	_ = json.Unmarshal(body, &r)
	if resp.StatusCode != 200 || r.Checks["kafka"] != "ok" || r.Checks["redis"] != "ok" || r.Checks["postgres"] != "" {
		t.Fatalf("ready = %d %s", resp.StatusCode, body)
	}
	resp, err = http.Get("http://" + a.HTTPAddr.String() + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, want := range []string{"go_goroutines", "kade_realtime_ws_connections"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("/metrics missing %s", want)
		}
	}
}

func TestRejectsSocketsWithoutIdentity(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, resp, err := websocket.Dial(ctx, ws, nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("want 401, got resp=%v err=%v", resp, err)
	}
}

// End to end: Kafka event → consumer → Redis pub/sub → WebSocket, with authorisation.
func TestOrderLifecycleEndToEnd(t *testing.T) {
	orderID, customer, outlet, rider := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	deliveryID := uuid.NewString()
	now := time.Now()

	kitchen := connect(t, ident("staff-"+outlet, "merchant_staff", "X-Outlet-Id", outlet))
	if res := kitchen.subscribe("outlet:" + outlet); len(res.GetGranted()) != 1 {
		t.Fatalf("kitchen subscribe: %v", res)
	}
	ops := connect(t, ident("ops-it", "ops"))
	if res := ops.subscribe("ops:live"); len(res.GetGranted()) != 1 {
		t.Fatalf("ops subscribe: %v", res)
	}
	riderSock := connect(t, ident("rider-user-"+rider, "rider", "X-Rider-Id", rider))
	if res := riderSock.subscribe("rider:" + rider); len(res.GetGranted()) != 1 {
		t.Fatalf("rider subscribe: %v", res)
	}
	time.Sleep(100 * time.Millisecond) // Redis SUBSCRIBE confirmation

	o := &orderv1.Order{
		Id: orderID, OrderNumber: "KD-9" + orderID[len(orderID)-3:], Status: orderv1.OrderStatus_ORDER_STATUS_PLACED,
		Mode:       commonv1.FulfilmentMode_FULFILMENT_MODE_DELIVERY,
		Customer:   &commonv1.Contact{Id: customer, Name: "Dilini Perera", Phone: "+94771234567"},
		Restaurant: &orderv1.OrderRestaurant{Id: outlet, Name: "Galle Road Kottu House"},
		Lines:      []*orderv1.OrderLine{{ItemId: "i1", Name: "Chicken kottu", Quantity: 1}},
		PlacedAt:   timestamppb.New(now), DueAt: timestamppb.New(now.Add(40 * time.Minute)),
	}
	produce(t, orderID, &orderv1.OrderPlaced{OrderId: orderID, Order: o, OccurredAt: timestamppb.Now()})

	// The kitchen board gets a new ticket with the chime flag.
	m := kitchen.waitMessage("outlet:"+outlet, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetKitchenTicket().GetTicket().GetOrderId() == orderID
	})
	if !m.GetKitchenTicket().GetIsNew() || m.GetKitchenTicket().GetTicket().GetStatus() != merchantv1.TicketStatus_TICKET_STATUS_NEW ||
		m.GetSourceType() != "kade.order.v1.OrderPlaced" {
		t.Fatalf("kitchen frame %v", m)
	}

	// The customer may now watch their order; a stranger and another rider may not.
	cust := connect(t, ident(customer, "customer"))
	if res := cust.subscribe("order:"+orderID, "customer:"+customer); len(res.GetGranted()) != 2 {
		t.Fatalf("customer subscribe: %v", res)
	}
	stranger := connect(t, ident(uuid.NewString(), "customer"))
	if res := stranger.subscribe("order:"+orderID, "customer:"+customer, "outlet:"+outlet, "rider:"+rider, "ops:live"); len(res.GetGranted()) != 0 || len(res.GetDenied()) != 5 {
		t.Fatalf("stranger should be denied everything: %v", res)
	}
	otherRider := connect(t, ident("rider-other", "rider", "X-Rider-Id", uuid.NewString()))
	if res := otherRider.subscribe("rider:"+rider, "order:"+orderID); len(res.GetGranted()) != 0 {
		t.Fatalf("other rider granted %v", res.GetGranted())
	}
	time.Sleep(100 * time.Millisecond)

	produce(t, outlet, &merchantv1.TicketAccepted{OutletId: outlet, OrderId: orderID, OrderNumber: o.OrderNumber, PrepMinutes: 15, OccurredAt: timestamppb.Now()})
	accepted := proto.Clone(o).(*orderv1.Order)
	accepted.Status = orderv1.OrderStatus_ORDER_STATUS_ACCEPTED
	accepted.PrepMinutes = 15
	produce(t, orderID, &orderv1.OrderAccepted{OrderId: orderID, Order: accepted, PrepMinutes: 15, OccurredAt: timestamppb.Now()})

	m = cust.waitMessage("order:"+orderID, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetOrder().GetOrder().GetStatus() == orderv1.OrderStatus_ORDER_STATUS_ACCEPTED
	})
	if m.GetOrder().GetOrder().GetCustomer().GetPhone() != "" {
		t.Fatal("customer phone leaked onto the order channel")
	}
	kitchen.waitMessage("outlet:"+outlet, 10*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetKitchenTicket().GetTicket().GetStatus() == merchantv1.TicketStatus_TICKET_STATUS_PREPARING
	})

	// Dispatch: offer → assignment → the rider gets the job and the customer sees the rider.
	produce(t, deliveryID, &dispatchv1.DeliveryOfferSent{DeliveryId: deliveryID, OrderId: orderID, OccurredAt: timestamppb.Now(),
		Offer: &dispatchv1.DeliveryOffer{Id: "offer-" + deliveryID, DeliveryId: deliveryID, RiderId: rider, ExpiresAt: timestamppb.New(time.Now().Add(30 * time.Second))}})
	riderSock.waitMessage("rider:"+rider, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetRiderOffer().GetOffer().GetDeliveryId() == deliveryID
	})
	produce(t, deliveryID, &dispatchv1.RiderAssigned{DeliveryId: deliveryID, OrderId: orderID, OrderNumber: o.OrderNumber, RestaurantId: outlet,
		Rider: &dispatchv1.RiderCard{RiderId: rider, Name: "Nimal Silva", Phone: "+94770000000"}, OccurredAt: timestamppb.Now()})
	riderSock.waitMessage("rider:"+rider, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetRiderJob().GetDelivery().GetRiderId() == rider
	})
	m = cust.waitMessage("order:"+orderID, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetOrder().GetOrder().GetRider().GetRiderId() == rider
	})
	if m.GetOrder().GetOrder().GetRider().GetPhone() != "" {
		t.Fatal("rider's real phone leaked to the customer")
	}

	// The assigned rider may now watch the order.
	if res := riderSock.subscribe("order:" + orderID); len(res.GetGranted()) != 1 {
		t.Fatalf("assigned rider subscribe: %v", res)
	}
	time.Sleep(100 * time.Millisecond)

	// GPS: throttled position on the order channel and a rider dot on ops:live.
	produceLocation(t, &locationv1.RiderLocation{RiderId: rider, OrderId: orderID, DeliveryId: deliveryID, Sequence: 1,
		Position: &commonv1.GeoPoint{Lat: 6.9, Lng: 79.85}, ReceivedAt: timestamppb.Now(), Activity: locationv1.RiderActivity_RIDER_ACTIVITY_TO_RESTAURANT})
	m = cust.waitMessage("order:"+orderID, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool { return m.GetRiderPosition() != nil })
	if m.GetRiderPosition().GetLocation().GetRiderId() != rider || m.GetRiderPosition().GetLocation().GetPosition().GetLat() != 6.9 {
		t.Fatalf("position %v", m)
	}
	ops.waitMessage("ops:live", 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		dots := m.GetOpsLive().GetSnapshot().GetDots()
		return len(dots) == 1 && dots[0].GetId() == rider
	})
	// Counters frame (coalesced) shows at least this order today.
	ops.waitMessage("ops:live", 30*time.Second, func(m *realtimev1.RealtimeMessage) bool {
		return m.GetSourceType() == "kade.dispatch.v1.LiveSnapshot" && m.GetOpsLive().GetSnapshot().GetOrdersToday() >= 1
	})

	// The denied sockets never received anything.
	stranger.silent(300 * time.Millisecond)
	otherRider.silent(10 * time.Millisecond)
}

func TestDuplicateEventsArePushedOnce(t *testing.T) {
	outlet := uuid.NewString()
	kitchen := connect(t, ident("staff", "merchant_owner", "X-Outlet-Id", outlet))
	kitchen.subscribe("outlet:" + outlet)
	time.Sleep(100 * time.Millisecond)
	id := uuid.New()
	evt := &merchantv1.TicketReady{OutletId: outlet, OrderId: uuid.NewString(), OrderNumber: "KD-1", OccurredAt: timestamppb.Now()}
	first, _ := kafka.NewRecord(eventsTopic, outlet, id, evt)
	again, _ := kafka.NewRecord(eventsTopic, outlet, id, evt) // redelivery: same event id
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := raw.ProduceSync(ctx, first, again).FirstErr(); err != nil {
		t.Fatal(err)
	}
	kitchen.waitMessage("outlet:"+outlet, 30*time.Second, func(m *realtimev1.RealtimeMessage) bool { return m.GetKitchenTicket() != nil })
	kitchen.silent(time.Second)
}
