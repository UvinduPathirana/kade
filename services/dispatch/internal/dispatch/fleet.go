package dispatch

import (
	"context"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/redis/go-redis/v9"
)

// Redis keys. dispatch owns the two `dispatch:` keys; the `location:` keys belong to the location
// service (services/location/README.md) and are only read here.
const (
	// KeyAvailable is a GEO set of riders who are online, idle and not suspended (member = rider id).
	// Matching searches it nearest-first around the restaurant.
	KeyAvailable = "dispatch:riders:available:colombo"
	// KeyAvailableSeen is a sorted set: member = rider id, score = last position update (Unix ms).
	// Riders not updated within RIDER_STALE_AFTER are skipped by matching.
	KeyAvailableSeen = "dispatch:riders:available:seen"

	// Owned by location: last known position of every rider that reported recently.
	KeyLocationGeo  = "location:riders:geo"
	KeyLocationSeen = "location:riders:seen"
)

// Fleet is the Redis side of dispatch: who is available where, and where every rider last was.
type Fleet struct{ rdb redis.UniversalClient }

func NewFleet(rdb redis.UniversalClient) *Fleet { return &Fleet{rdb: rdb} }

// MakeAvailable adds (or moves) a rider in the available index.
func (f *Fleet) MakeAvailable(ctx context.Context, riderID string, p *commonv1.GeoPoint, seen time.Time) error {
	if !validPoint(p) {
		return nil
	}
	_, err := f.rdb.Pipelined(ctx, func(pl redis.Pipeliner) error {
		pl.GeoAdd(ctx, KeyAvailable, &redis.GeoLocation{Name: riderID, Latitude: p.GetLat(), Longitude: p.GetLng()})
		pl.ZAdd(ctx, KeyAvailableSeen, redis.Z{Score: float64(seen.UnixMilli()), Member: riderID})
		return nil
	})
	return err
}

// MakeUnavailable removes riders from the available index (offline, on a job, suspended).
func (f *Fleet) MakeUnavailable(ctx context.Context, riderIDs ...string) error {
	if len(riderIDs) == 0 {
		return nil
	}
	members := make([]any, len(riderIDs))
	for i, id := range riderIDs {
		members[i] = id
	}
	_, err := f.rdb.Pipelined(ctx, func(pl redis.Pipeliner) error {
		pl.ZRem(ctx, KeyAvailable, members...)
		pl.ZRem(ctx, KeyAvailableSeen, members...)
		return nil
	})
	return err
}

// Move updates positions of riders that are already available (GEOADD XX): pings of riders on a
// job or offline never put them back in the index.
func (f *Fleet) Move(ctx context.Context, locs []*locationv1.RiderLocation) error {
	if len(locs) == 0 {
		return nil
	}
	_, err := f.rdb.Pipelined(ctx, func(pl redis.Pipeliner) error {
		for _, l := range locs {
			p := l.GetPosition()
			if !validPoint(p) {
				continue
			}
			seen := time.Now()
			if l.GetReceivedAt() != nil {
				seen = l.GetReceivedAt().AsTime()
			}
			pl.Do(ctx, "GEOADD", KeyAvailable, "XX", p.GetLng(), p.GetLat(), l.GetRiderId())
			pl.ZAddXX(ctx, KeyAvailableSeen, redis.Z{Score: float64(seen.UnixMilli()), Member: l.GetRiderId()})
		}
		return nil
	})
	return err
}

// Candidate is an available rider near a point.
type Candidate struct {
	RiderID  string
	Km       float64 // straight line
	Position *commonv1.GeoPoint
	Seen     time.Time
}

// Nearby lists available riders within radiusKm of p, nearest first.
func (f *Fleet) Nearby(ctx context.Context, p *commonv1.GeoPoint, radiusKm float64, limit int) ([]Candidate, error) {
	locs, err := f.rdb.GeoSearchLocation(ctx, KeyAvailable, &redis.GeoSearchLocationQuery{
		GeoSearchQuery: redis.GeoSearchQuery{Longitude: p.GetLng(), Latitude: p.GetLat(), Radius: radiusKm, RadiusUnit: "km", Sort: "ASC", Count: limit},
		WithCoord:      true, WithDist: true,
	}).Result()
	if err != nil || len(locs) == 0 {
		return nil, err
	}
	ids := make([]string, len(locs))
	for i, l := range locs {
		ids[i] = l.Name
	}
	scores, err := f.rdb.ZMScore(ctx, KeyAvailableSeen, ids...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Candidate, len(locs))
	for i, l := range locs {
		out[i] = Candidate{RiderID: l.Name, Km: l.Dist, Position: &commonv1.GeoPoint{Lat: l.Latitude, Lng: l.Longitude}}
		if i < len(scores) && scores[i] > 0 {
			out[i].Seen = time.UnixMilli(int64(scores[i]))
		}
	}
	return out, nil
}

// AvailableMembers lists every rider id in the available index.
func (f *Fleet) AvailableMembers(ctx context.Context) ([]string, error) {
	return f.rdb.ZRange(ctx, KeyAvailable, 0, -1).Result()
}

// Fix is a known position and when it was taken.
type Fix struct {
	Position *commonv1.GeoPoint
	Seen     time.Time
}

// Positions returns the freshest known position per rider: location's last known position, then
// dispatch's available index. Riders with neither are absent from the map.
func (f *Fleet) Positions(ctx context.Context, riderIDs []string) (map[string]Fix, error) {
	out := map[string]Fix{}
	if len(riderIDs) == 0 {
		return out, nil
	}
	var locPos, availPos *redis.GeoPosCmd
	var locSeen, availSeen *redis.FloatSliceCmd
	_, err := f.rdb.Pipelined(ctx, func(pl redis.Pipeliner) error {
		locPos = pl.GeoPos(ctx, KeyLocationGeo, riderIDs...)
		locSeen = pl.ZMScore(ctx, KeyLocationSeen, riderIDs...)
		availPos = pl.GeoPos(ctx, KeyAvailable, riderIDs...)
		availSeen = pl.ZMScore(ctx, KeyAvailableSeen, riderIDs...)
		return nil
	})
	if err != nil && err != redis.Nil {
		return out, err
	}
	pick := func(pos []*redis.GeoPos, seen []float64, i int) (Fix, bool) {
		if i >= len(pos) || pos[i] == nil {
			return Fix{}, false
		}
		fx := Fix{Position: &commonv1.GeoPoint{Lat: pos[i].Latitude, Lng: pos[i].Longitude}}
		if i < len(seen) && seen[i] > 0 {
			fx.Seen = time.UnixMilli(int64(seen[i]))
		}
		return fx, true
	}
	lp, ls, ap, as := locPos.Val(), locSeen.Val(), availPos.Val(), availSeen.Val()
	for i, id := range riderIDs {
		a, okA := pick(lp, ls, i)
		b, okB := pick(ap, as, i)
		switch {
		case okA && okB && b.Seen.After(a.Seen):
			out[id] = b
		case okA:
			out[id] = a
		case okB:
			out[id] = b
		}
	}
	return out, nil
}
