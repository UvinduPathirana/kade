// Package identity reads the caller identity that gateways attach when they reverse-proxy a
// WebSocket upgrade to realtime. Gateways validate the Keycloak JWT; realtime trusts the internal
// network and authorises every Subscribe from these headers.
package identity

import (
	"net/http"
	"slices"
	"strings"
)

// Headers set by the gateways on the proxied upgrade request.
const (
	HeaderUserID   = "X-User-Id"   // Keycloak sub; a customer's id IS their sub
	HeaderRoles    = "X-Roles"     // comma-separated realm roles
	HeaderOutletID = "X-Outlet-Id" // merchant staff: outlet id(s), comma-separated
	HeaderRiderID  = "X-Rider-Id"  // riders: dispatch rider id (from RiderService.GetMyRider)
)

// Roles (Keycloak realm kade).
const (
	RoleCustomer      = "customer"
	RoleMerchantStaff = "merchant_staff"
	RoleMerchantOwner = "merchant_owner"
	RoleRider         = "rider"
	RoleOps           = "ops"
	RoleFinance       = "finance"
	RoleSupport       = "support"
	RoleAdmin         = "admin"
)

type Identity struct {
	UserID    string
	Roles     []string
	OutletIDs []string
	RiderID   string
	// Dev is true when the identity came from query parameters under AUTH_DEV_BYPASS.
	Dev bool
}

func (i Identity) Authenticated() bool { return i.UserID != "" }

// HasRole reports whether the caller has any of roles.
func (i Identity) HasRole(roles ...string) bool {
	for _, r := range roles {
		if slices.Contains(i.Roles, r) {
			return true
		}
	}
	return false
}

// HasOutlet reports whether outletID is one of the caller's outlets.
func (i Identity) HasOutlet(outletID string) bool { return slices.Contains(i.OutletIDs, outletID) }

// FromRequest reads the identity headers. With devBypass, query parameters user, roles, outlet
// and rider fill in when the headers are absent (for wswatch and local experiments only).
func FromRequest(r *http.Request, devBypass bool) Identity {
	h := r.Header
	id := Identity{
		UserID:    strings.TrimSpace(h.Get(HeaderUserID)),
		Roles:     list(h.Values(HeaderRoles)),
		OutletIDs: list(h.Values(HeaderOutletID)),
		RiderID:   strings.TrimSpace(h.Get(HeaderRiderID)),
	}
	if devBypass && id.UserID == "" {
		q := r.URL.Query()
		if u := strings.TrimSpace(q.Get("user")); u != "" {
			id = Identity{
				UserID:    u,
				Roles:     list(q["roles"]),
				OutletIDs: list(q["outlet"]),
				RiderID:   strings.TrimSpace(q.Get("rider")),
				Dev:       true,
			}
		}
	}
	return id
}

// list splits comma-separated values, trims and de-duplicates them.
func list(raw []string) []string {
	var out []string
	for _, v := range raw {
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" && !slices.Contains(out, p) {
				out = append(out, p)
			}
		}
	}
	return out
}
