// Package auth carries the caller identity that gateways pass as gRPC metadata
// (x-user-id, x-roles, x-outlet-id). Services trust the internal network and authorise from it.
package auth

import (
	"context"
	"slices"
	"strings"

	"google.golang.org/grpc/metadata"
)

const (
	HeaderUserID   = "x-user-id"
	HeaderRoles    = "x-roles" // comma-separated
	HeaderOutletID = "x-outlet-id"
)

type Identity struct {
	UserID   string
	Roles    []string
	OutletID string
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

type ctxKey struct{}

func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// FromContext returns the caller identity (zero value for anonymous/internal calls).
func FromContext(ctx context.Context) Identity {
	id, _ := ctx.Value(ctxKey{}).(Identity)
	return id
}

// FromMetadata parses identity headers from incoming gRPC metadata.
func FromMetadata(md metadata.MD) Identity {
	first := func(k string) string {
		if v := md.Get(k); len(v) > 0 {
			return strings.TrimSpace(v[0])
		}
		return ""
	}
	id := Identity{UserID: first(HeaderUserID), OutletID: first(HeaderOutletID)}
	for _, raw := range md.Get(HeaderRoles) {
		for _, r := range strings.Split(raw, ",") {
			if r = strings.TrimSpace(r); r != "" && !slices.Contains(id.Roles, r) {
				id.Roles = append(id.Roles, r)
			}
		}
	}
	return id
}

// AppendToOutgoing forwards the identity on calls to other services.
func AppendToOutgoing(ctx context.Context, id Identity) context.Context {
	if !id.Authenticated() {
		return ctx
	}
	kv := []string{HeaderUserID, id.UserID}
	if len(id.Roles) > 0 {
		kv = append(kv, HeaderRoles, strings.Join(id.Roles, ","))
	}
	if id.OutletID != "" {
		kv = append(kv, HeaderOutletID, id.OutletID)
	}
	return metadata.AppendToOutgoingContext(ctx, kv...)
}
