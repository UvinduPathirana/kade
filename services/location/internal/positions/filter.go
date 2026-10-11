// Package positions ingests rider GPS fixes: it drops duplicates, out-of-order and implausible
// fixes, produces the rest to kade.rider.locations (Schema Registry, key = rider id) and keeps the
// last known position of every rider in Redis (keys in store.go, shared read-only with dispatch).
package positions

import (
	"math"
	"sync"
	"time"

	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
)

// Drop reasons (also the `outcome` label of the kade.location.positions metric).
const (
	DropInvalid     = "invalid"     // no rider id, no/impossible coordinates
	DropDuplicate   = "duplicate"   // sequence/time not newer than the last accepted fix
	DropImplausible = "implausible" // jump faster than MaxSpeedMPS
)

// Filter remembers the last accepted fix per rider (in memory, per instance) and decides whether a
// new fix is worth keeping. After a restart the first fix of every rider is accepted.
type Filter struct {
	MaxSpeedMPS float64
	// A rider silent for longer than this may reappear anywhere (app reopened across town).
	ResetAfter time.Duration
	// After this many consecutive implausible fixes the new position wins (the old one was wrong).
	MaxJumpDrops int

	mu   sync.Mutex
	last map[string]*fixState
}

type fixState struct {
	seq       int64
	at        time.Time // device time of the fix
	seen      time.Time // when we accepted it
	lat, lng  float64
	jumpDrops int
}

func NewFilter(maxSpeedMPS float64) *Filter {
	return &Filter{MaxSpeedMPS: maxSpeedMPS, ResetAfter: 5 * time.Minute, MaxJumpDrops: 3, last: map[string]*fixState{}}
}

// Accept normalises loc (occurred_at defaults to now and is clamped to now) and returns "" when it
// should be kept, or the drop reason.
func (f *Filter) Accept(loc *locationv1.RiderLocation, now time.Time) string {
	p := loc.GetPosition()
	if loc.GetRiderId() == "" || p == nil || !ValidPoint(p.GetLat(), p.GetLng()) {
		return DropInvalid
	}
	at := now
	if ts := loc.GetOccurredAt(); ts != nil && ts.IsValid() && ts.AsTime().Before(now) {
		at = ts.AsTime()
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	prev, ok := f.last[loc.GetRiderId()]
	if ok && now.Sub(prev.seen) < f.ResetAfter {
		if loc.GetSequence() > 0 && prev.seq > 0 {
			if loc.GetSequence() <= prev.seq {
				return DropDuplicate
			}
		} else if !at.After(prev.at) {
			return DropDuplicate
		}
		dt := max(at.Sub(prev.at).Seconds(), 1)
		dist := HaversineMeters(prev.lat, prev.lng, p.GetLat(), p.GetLng())
		if dist > 200 && dist/dt > f.MaxSpeedMPS && prev.jumpDrops < f.MaxJumpDrops {
			prev.jumpDrops++
			return DropImplausible
		}
	}
	f.last[loc.GetRiderId()] = &fixState{seq: loc.GetSequence(), at: at, seen: now, lat: p.GetLat(), lng: p.GetLng()}
	return ""
}

// Prune forgets riders not seen since before; returns how many were removed.
func (f *Filter) Prune(before time.Time) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for id, s := range f.last {
		if s.seen.Before(before) {
			delete(f.last, id)
			n++
		}
	}
	return n
}

// Len is the number of riders remembered (for tests and metrics).
func (f *Filter) Len() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.last)
}

// ValidPoint rejects (0,0) (proto3 default) and anything Redis GEO cannot index.
func ValidPoint(lat, lng float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lng) || (lat == 0 && lng == 0) {
		return false
	}
	return lat >= -85.05112878 && lat <= 85.05112878 && lng >= -180 && lng <= 180
}

const earthRadiusM = 6371008.8

// HaversineMeters is the great-circle distance between two WGS84 points.
func HaversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}
