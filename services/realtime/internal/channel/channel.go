// Package channel names realtime's channels and decides who may subscribe to them.
//
// Every rule is explicit and lives in Authorize; anything not listed is denied.
//
//	channel              who may subscribe
//	order:<order_id>     staff (ops, admin, support); the order's customer; staff of the order's outlet;
//	                     the rider assigned to the order
//	customer:<id>        staff; the customer themself (id = x-user-id)
//	group:<group_id>     staff; the host and members of the group order
//	outlet:<outlet_id>   ops, admin, support; merchant_staff/merchant_owner whose x-outlet-id lists it
//	restaurant:<id>      anyone (public availability changes)
//	rider:<rider_id>     ops, admin, support; the rider themself (role rider and x-rider-id = id)
//	ticket:<ticket_id>   support, ops, admin; the ticket's requester (customer = x-user-id, rider =
//	                     x-rider-id, restaurant = one of x-outlet-id with a merchant role)
//	ops:live             ops, admin, support
//
// Ownership (order → customer/outlet/rider, group → members, ticket → requester) comes from the
// events realtime consumes, kept in Redis. An order realtime has not seen yet (the customer opens
// the tracking page before OrderPlaced arrives) is looked up once through order.GetOrder when
// ORDER_GRPC is configured.
package channel

import (
	"context"
	"regexp"
	"slices"

	"github.com/UvinduPathirana/kade/services/realtime/internal/identity"
)

const (
	KindOrder      = "order"
	KindCustomer   = "customer"
	KindGroup      = "group"
	KindOutlet     = "outlet"
	KindRestaurant = "restaurant"
	KindRider      = "rider"
	KindTicket     = "ticket"
	KindOps        = "ops"

	OpsLive = "ops:live"
)

func Order(id string) string      { return KindOrder + ":" + id }
func Customer(id string) string   { return KindCustomer + ":" + id }
func Group(id string) string      { return KindGroup + ":" + id }
func Outlet(id string) string     { return KindOutlet + ":" + id }
func Restaurant(id string) string { return KindRestaurant + ":" + id }
func Rider(id string) string      { return KindRider + ":" + id }
func Ticket(id string) string     { return KindTicket + ":" + id }

var pattern = regexp.MustCompile(`^([a-z]{1,16}):([A-Za-z0-9_.-]{1,128})$`)

// Parse splits "kind:id". ok is false for malformed names.
func Parse(ch string) (kind, id string, ok bool) {
	m := pattern.FindStringSubmatch(ch)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// OrderAccess is who an order belongs to.
type OrderAccess struct {
	CustomerID string
	OutletID   string
	RiderID    string
}

// Owners is the ownership index (Redis, filled from events).
type Owners interface {
	OrderAccess(ctx context.Context, orderID string) (OrderAccess, bool, error)
	SaveOrderAccess(ctx context.Context, orderID string, a OrderAccess) error
	GroupMembers(ctx context.Context, groupID string) ([]string, error)
	TicketRequester(ctx context.Context, ticketID string) (string, error)
}

// OrderLookup asks the order service (as the caller) for an order realtime hasn't seen yet.
// found=false when it doesn't exist or the caller may not see it.
type OrderLookup func(ctx context.Context, id identity.Identity, orderID string) (a OrderAccess, found bool, err error)

type Authorizer struct {
	Owners Owners
	Lookup OrderLookup // optional
}

// Authorize reports whether id may subscribe to ch. Errors (Redis down) deny.
func (a *Authorizer) Authorize(ctx context.Context, id identity.Identity, ch string) (bool, error) {
	kind, key, ok := Parse(ch)
	if !ok {
		return false, nil
	}
	if kind == KindRestaurant {
		return true, nil // public
	}
	if !id.Authenticated() {
		return false, nil
	}
	staff := id.HasRole(identity.RoleOps, identity.RoleAdmin, identity.RoleSupport)
	switch kind {
	case KindOps:
		return key == "live" && staff, nil
	case KindCustomer:
		return staff || key == id.UserID, nil
	case KindRider:
		return staff || (id.HasRole(identity.RoleRider) && id.RiderID != "" && key == id.RiderID), nil
	case KindOutlet:
		return staff || (id.HasRole(identity.RoleMerchantStaff, identity.RoleMerchantOwner) && id.HasOutlet(key)), nil
	case KindOrder:
		if staff {
			return true, nil
		}
		return a.order(ctx, id, key)
	case KindGroup:
		if staff {
			return true, nil
		}
		members, err := a.Owners.GroupMembers(ctx, key)
		if err != nil {
			return false, err
		}
		return slices.Contains(members, id.UserID), nil
	case KindTicket:
		if staff {
			return true, nil
		}
		requester, err := a.Owners.TicketRequester(ctx, key)
		if err != nil {
			return false, err
		}
		// Requester ids are a customer id (= user id), a rider id or an outlet id.
		switch {
		case requester == "":
			return false, nil
		case requester == id.UserID:
			return true, nil
		case id.HasRole(identity.RoleRider) && requester == id.RiderID:
			return true, nil
		case id.HasRole(identity.RoleMerchantStaff, identity.RoleMerchantOwner) && id.HasOutlet(requester):
			return true, nil
		}
		return false, nil
	}
	return false, nil
}

func (a *Authorizer) order(ctx context.Context, id identity.Identity, orderID string) (bool, error) {
	acc, found, err := a.Owners.OrderAccess(ctx, orderID)
	if err != nil {
		return false, err
	}
	if !found && a.Lookup != nil {
		if acc, found, err = a.Lookup(ctx, id, orderID); err != nil {
			return false, err
		}
		if found {
			if err := a.Owners.SaveOrderAccess(ctx, orderID, acc); err != nil {
				return false, err
			}
		}
	}
	if !found {
		return false, nil
	}
	return OrderVisibleTo(acc, id), nil
}

// OrderVisibleTo applies the order:<id> rule to a known owner set (staff are handled by the caller).
func OrderVisibleTo(acc OrderAccess, id identity.Identity) bool {
	switch {
	case acc.CustomerID != "" && acc.CustomerID == id.UserID:
		return true
	case acc.OutletID != "" && id.HasRole(identity.RoleMerchantStaff, identity.RoleMerchantOwner) && id.HasOutlet(acc.OutletID):
		return true
	case acc.RiderID != "" && id.HasRole(identity.RoleRider) && id.RiderID == acc.RiderID:
		return true
	}
	return false
}
