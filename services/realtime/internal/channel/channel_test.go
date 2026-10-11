package channel

import (
	"context"
	"errors"
	"testing"

	"github.com/UvinduPathirana/kade/services/realtime/internal/identity"
)

type fakeOwners struct {
	orders  map[string]OrderAccess
	groups  map[string][]string
	tickets map[string]string
	err     error
	saved   map[string]OrderAccess
}

func (f *fakeOwners) OrderAccess(_ context.Context, id string) (OrderAccess, bool, error) {
	a, ok := f.orders[id]
	return a, ok, f.err
}
func (f *fakeOwners) SaveOrderAccess(_ context.Context, id string, a OrderAccess) error {
	if f.saved == nil {
		f.saved = map[string]OrderAccess{}
	}
	f.saved[id] = a
	return nil
}
func (f *fakeOwners) GroupMembers(_ context.Context, id string) ([]string, error) {
	return f.groups[id], f.err
}
func (f *fakeOwners) TicketRequester(_ context.Context, id string) (string, error) {
	return f.tickets[id], f.err
}

const (
	dilini = "00000000-0000-7000-8005-000000000001" // customer
	ruwan  = "00000000-0000-7000-8005-000000000002" // merchant owner, outlet 1
	nimal  = "00000000-0000-7000-8005-000000000004" // rider user
	outlet = "00000000-0000-7000-8000-000000000001"
	other  = "00000000-0000-7000-8000-000000000002"
	riderN = "00000000-0000-7000-8001-000000000101"
	order1 = "00000000-0000-7000-8003-000000004821"
)

var (
	customer   = identity.Identity{UserID: dilini, Roles: []string{"customer"}}
	stranger   = identity.Identity{UserID: "00000000-0000-7000-8005-000000000099", Roles: []string{"customer"}}
	owner      = identity.Identity{UserID: ruwan, Roles: []string{"merchant_owner", "merchant_staff", "customer"}, OutletIDs: []string{outlet}}
	otherStaff = identity.Identity{UserID: "u-other", Roles: []string{"merchant_staff"}, OutletIDs: []string{other}}
	rider      = identity.Identity{UserID: nimal, Roles: []string{"rider", "customer"}, RiderID: riderN}
	riderNoID  = identity.Identity{UserID: nimal, Roles: []string{"rider"}}
	ops        = identity.Identity{UserID: "ops", Roles: []string{"ops"}}
	support    = identity.Identity{UserID: "support", Roles: []string{"support"}}
	finance    = identity.Identity{UserID: "finance", Roles: []string{"finance", "customer"}}
	anonymous  = identity.Identity{}
	// A customer who claims an outlet without the merchant role must not see it.
	fakeOutlet = identity.Identity{UserID: dilini, Roles: []string{"customer"}, OutletIDs: []string{outlet}}
)

func newAuthorizer() (*Authorizer, *fakeOwners) {
	o := &fakeOwners{
		orders:  map[string]OrderAccess{order1: {CustomerID: dilini, OutletID: outlet, RiderID: riderN}},
		groups:  map[string][]string{"g1": {dilini, "member-2"}},
		tickets: map[string]string{"t1": dilini, "t-rider": riderN, "t-outlet": outlet},
	}
	return &Authorizer{Owners: o}, o
}

func TestAuthorizeMatrix(t *testing.T) {
	a, _ := newAuthorizer()
	cases := []struct {
		who  string
		id   identity.Identity
		ch   string
		want bool
	}{
		// order:<id>
		{"customer own order", customer, Order(order1), true},
		{"other customer", stranger, Order(order1), false},
		{"outlet staff of the order", owner, Order(order1), true},
		{"staff of another outlet", otherStaff, Order(order1), false},
		{"customer claiming an outlet", fakeOutlet, Order(order1), true}, // still their own order
		{"assigned rider", rider, Order(order1), true},
		{"rider without rider id", riderNoID, Order(order1), false},
		{"ops any order", ops, Order(order1), true},
		{"support any order", support, Order(order1), true},
		{"finance is not ops", finance, Order(order1), false},
		{"unknown order", customer, Order("nope"), false},
		{"anonymous", anonymous, Order(order1), false},
		// customer:<id>
		{"own customer channel", customer, Customer(dilini), true},
		{"someone else's", stranger, Customer(dilini), false},
		{"ops customer channel", ops, Customer(dilini), true},
		// outlet:<id>
		{"owner own outlet", owner, Outlet(outlet), true},
		{"owner other outlet", owner, Outlet(other), false},
		{"customer with outlet header but no role", fakeOutlet, Outlet(outlet), false},
		{"ops outlet", ops, Outlet(outlet), true},
		{"rider outlet", rider, Outlet(outlet), false},
		// rider:<id>
		{"rider self", rider, Rider(riderN), true},
		{"rider other", rider, Rider("00000000-0000-7000-8001-000000000102"), false},
		{"customer rider channel", customer, Rider(riderN), false},
		{"rider id header without role", identity.Identity{UserID: "x", Roles: []string{"customer"}, RiderID: riderN}, Rider(riderN), false},
		{"ops rider", ops, Rider(riderN), true},
		// ops:live
		{"ops live", ops, OpsLive, true},
		{"admin live", identity.Identity{UserID: "admin", Roles: []string{"admin"}}, OpsLive, true},
		{"support live", support, OpsLive, true},
		{"customer live", customer, OpsLive, false},
		{"merchant live", owner, OpsLive, false},
		{"finance live", finance, OpsLive, false},
		{"ops other ops channel", ops, "ops:secret", false},
		// group / ticket / restaurant
		{"group member", customer, Group("g1"), true},
		{"group stranger", stranger, Group("g1"), false},
		{"ticket requester", customer, Ticket("t1"), true},
		{"ticket stranger", stranger, Ticket("t1"), false},
		{"ticket support", support, Ticket("t1"), true},
		{"rider ticket", rider, Ticket("t-rider"), true},
		{"rider ticket, customer with same id as rider id", identity.Identity{UserID: "x", Roles: []string{"customer"}, RiderID: riderN}, Ticket("t-rider"), false},
		{"restaurant ticket", owner, Ticket("t-outlet"), true},
		{"restaurant ticket other outlet", otherStaff, Ticket("t-outlet"), false},
		{"restaurant public", anonymous, Restaurant(outlet), true},
		// malformed / unknown
		{"unknown kind", ops, "payments:1", false},
		{"malformed", ops, "order:", false},
		{"injection", ops, "order:1 *", false},
	}
	for _, tc := range cases {
		t.Run(tc.who+" "+tc.ch, func(t *testing.T) {
			got, err := a.Authorize(context.Background(), tc.id, tc.ch)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("Authorize(%s, %q) = %v, want %v", tc.who, tc.ch, got, tc.want)
			}
		})
	}
}

func TestOrderLookupFallback(t *testing.T) {
	a, o := newAuthorizer()
	calls := 0
	a.Lookup = func(_ context.Context, id identity.Identity, orderID string) (OrderAccess, bool, error) {
		calls++
		if orderID == "new" && id.UserID == dilini {
			return OrderAccess{CustomerID: dilini, OutletID: outlet}, true, nil
		}
		return OrderAccess{}, false, nil
	}
	if ok, _ := a.Authorize(context.Background(), customer, Order("new")); !ok {
		t.Fatal("customer should see their new order via the order service")
	}
	if o.saved["new"].CustomerID != dilini {
		t.Fatal("lookup result not cached in the ownership index")
	}
	if ok, _ := a.Authorize(context.Background(), stranger, Order("other")); ok {
		t.Fatal("not found must deny")
	}
	// Known orders never call the order service.
	before := calls
	_, _ = a.Authorize(context.Background(), customer, Order(order1))
	if calls != before {
		t.Fatal("lookup called for a known order")
	}
}

func TestErrorsDeny(t *testing.T) {
	a, o := newAuthorizer()
	o.err = errors.New("redis down")
	ok, err := a.Authorize(context.Background(), customer, Order(order1))
	if ok || err == nil {
		t.Fatalf("ok=%v err=%v; want deny with error", ok, err)
	}
}

func TestParse(t *testing.T) {
	if k, id, ok := Parse("order:" + order1); !ok || k != "order" || id != order1 {
		t.Fatalf("%s %s %v", k, id, ok)
	}
	for _, bad := range []string{"", "order", ":x", "Order:1", "order:a/b", "order:a:b"} {
		if _, _, ok := Parse(bad); ok {
			t.Errorf("Parse(%q) ok", bad)
		}
	}
}
