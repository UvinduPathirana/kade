package redisx

import (
	"context"
	"errors"

	"github.com/redis/go-redis/v9"
)

type Point struct{ Lat, Lng float64 }

type GeoHit struct {
	Member         string
	DistanceMeters float64
	Point          Point
}

// GeoIndex is a set of members with positions, searchable by radius. dispatch keeps one index of
// available riders per city: Upsert on every location ping, Remove when a rider goes offline or
// takes an offer, Nearby to pick candidates for an order.
//
// Redis GEO members never expire on their own. Pair the index with a liveness signal (e.g. a
// sorted set of last-seen times, trimmed by a ticker) so a rider whose app died drops out.
type GeoIndex interface {
	Upsert(ctx context.Context, member string, p Point) error
	Remove(ctx context.Context, members ...string) error
	Nearby(ctx context.Context, center Point, radiusMeters float64, limit int) ([]GeoHit, error)
}

type redisGeo struct {
	rdb redis.Cmdable
	key string
}

// NewGeoIndex stores the index under key, e.g. "dispatch:riders:available:colombo".
func NewGeoIndex(rdb redis.Cmdable, key string) GeoIndex { return &redisGeo{rdb: rdb, key: key} }

// ErrInvalidPoint is returned for coordinates Redis cannot index (|lat| > 85.05112878).
var ErrInvalidPoint = errors.New("invalid coordinates")

func (g *redisGeo) Upsert(ctx context.Context, member string, p Point) error {
	if p.Lat < -85.05112878 || p.Lat > 85.05112878 || p.Lng < -180 || p.Lng > 180 {
		return ErrInvalidPoint
	}
	return g.rdb.GeoAdd(ctx, g.key, &redis.GeoLocation{Name: member, Longitude: p.Lng, Latitude: p.Lat}).Err()
}

func (g *redisGeo) Remove(ctx context.Context, members ...string) error {
	if len(members) == 0 {
		return nil
	}
	args := make([]any, len(members))
	for i, m := range members {
		args[i] = m
	}
	return g.rdb.ZRem(ctx, g.key, args...).Err() // GEO sets are sorted sets
}

// Nearby returns members within radiusMeters of center, nearest first (GEOSEARCH ... ASC COUNT n).
func (g *redisGeo) Nearby(ctx context.Context, center Point, radiusMeters float64, limit int) ([]GeoHit, error) {
	q := &redis.GeoSearchLocationQuery{
		GeoSearchQuery: redis.GeoSearchQuery{
			Longitude:  center.Lng,
			Latitude:   center.Lat,
			Radius:     radiusMeters,
			RadiusUnit: "m",
			Sort:       "ASC",
			Count:      limit,
		},
		WithCoord: true,
		WithDist:  true,
	}
	locs, err := g.rdb.GeoSearchLocation(ctx, g.key, q).Result()
	if err != nil {
		return nil, err
	}
	hits := make([]GeoHit, len(locs))
	for i, l := range locs {
		hits[i] = GeoHit{Member: l.Name, DistanceMeters: l.Dist, Point: Point{Lat: l.Latitude, Lng: l.Longitude}}
	}
	return hits, nil
}
