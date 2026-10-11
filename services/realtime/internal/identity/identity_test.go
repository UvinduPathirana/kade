package identity

import (
	"net/http/httptest"
	"slices"
	"testing"
)

func TestFromHeaders(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws?user=evil&roles=ops", nil)
	r.Header.Set("x-user-id", " u1 ")
	r.Header.Add("x-roles", "merchant_staff, merchant_owner")
	r.Header.Add("x-roles", "customer,merchant_staff")
	r.Header.Set("x-outlet-id", "o1,o2")
	r.Header.Set("x-rider-id", "r1")
	id := FromRequest(r, true) // headers win even with the dev flag
	if id.UserID != "u1" || id.RiderID != "r1" || id.Dev {
		t.Fatalf("%+v", id)
	}
	if !slices.Equal(id.Roles, []string{"merchant_staff", "merchant_owner", "customer"}) || !id.HasOutlet("o2") || id.HasRole("ops") {
		t.Fatalf("%+v", id)
	}
}

func TestQueryIdentityOnlyWithDevBypass(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws?user=u9&roles=ops,admin&outlet=o1&rider=r9", nil)
	if id := FromRequest(r, false); id.Authenticated() {
		t.Fatalf("query identity used without dev bypass: %+v", id)
	}
	id := FromRequest(r, true)
	if id.UserID != "u9" || !id.HasRole("admin") || !id.HasOutlet("o1") || id.RiderID != "r9" || !id.Dev {
		t.Fatalf("%+v", id)
	}
}
