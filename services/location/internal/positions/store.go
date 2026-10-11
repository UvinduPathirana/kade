package positions

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/proto"
)

// Redis keys owned by location. dispatch (and anyone else on the stack) may READ them; only
// location writes them. Documented in services/location/README.md.
const (
	// KeyGeo is a GEO set: member = rider id, position = last accepted fix.
	KeyGeo = "location:riders:geo"
	// KeyLast is a hash: field = rider id, value = protobuf-encoded kade.location.v1.RiderLocation.
	KeyLast = "location:riders:last"
	// KeySeen is a sorted set: member = rider id, score = received_at in Unix milliseconds.
	KeySeen = "location:riders:seen"
)

// Store keeps the last known position per rider.
type Store interface {
	Save(ctx context.Context, locs []*locationv1.RiderLocation) error
	Last(ctx context.Context, riderID string) (*locationv1.RiderLocation, error)
	LastMany(ctx context.Context, riderIDs []string) ([]*locationv1.RiderLocation, error)
	// InBox returns riders whose last position is inside the box (south-west, north-east corners).
	InBox(ctx context.Context, swLat, swLng, neLat, neLng float64, limit int) ([]*locationv1.RiderLocation, error)
	// Trim removes riders whose last fix was received before `before`.
	Trim(ctx context.Context, before time.Time) (int, error)
}

type RedisStore struct{ rdb redis.UniversalClient }

func NewRedisStore(rdb redis.UniversalClient) *RedisStore { return &RedisStore{rdb: rdb} }

func (s *RedisStore) Save(ctx context.Context, locs []*locationv1.RiderLocation) error {
	if len(locs) == 0 {
		return nil
	}
	_, err := s.rdb.Pipelined(ctx, func(p redis.Pipeliner) error {
		for _, l := range locs {
			b, err := proto.Marshal(l)
			if err != nil {
				return err
			}
			p.GeoAdd(ctx, KeyGeo, &redis.GeoLocation{Name: l.GetRiderId(), Latitude: l.GetPosition().GetLat(), Longitude: l.GetPosition().GetLng()})
			p.HSet(ctx, KeyLast, l.GetRiderId(), b)
			p.ZAdd(ctx, KeySeen, redis.Z{Score: float64(l.GetReceivedAt().AsTime().UnixMilli()), Member: l.GetRiderId()})
		}
		return nil
	})
	return err
}

func (s *RedisStore) Last(ctx context.Context, riderID string) (*locationv1.RiderLocation, error) {
	b, err := s.rdb.HGet(ctx, KeyLast, riderID).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var l locationv1.RiderLocation
	if err := proto.Unmarshal(b, &l); err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *RedisStore) LastMany(ctx context.Context, riderIDs []string) ([]*locationv1.RiderLocation, error) {
	if len(riderIDs) == 0 {
		return nil, nil
	}
	vals, err := s.rdb.HMGet(ctx, KeyLast, riderIDs...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]*locationv1.RiderLocation, 0, len(vals))
	for _, v := range vals {
		str, ok := v.(string)
		if !ok {
			continue // nil: never reported
		}
		var l locationv1.RiderLocation
		if proto.Unmarshal([]byte(str), &l) == nil {
			out = append(out, &l)
		}
	}
	return out, nil
}

func (s *RedisStore) InBox(ctx context.Context, swLat, swLng, neLat, neLng float64, limit int) ([]*locationv1.RiderLocation, error) {
	cLat, cLng := (swLat+neLat)/2, (swLng+neLng)/2
	widthM := HaversineMeters(cLat, swLng, cLat, neLng)
	heightM := HaversineMeters(swLat, cLng, neLat, cLng)
	args := []any{"GEOSEARCH", KeyGeo, "FROMLONLAT", cLng, cLat, "BYBOX",
		strconv.FormatFloat(math.Max(widthM, 1), 'f', 1, 64), strconv.FormatFloat(math.Max(heightM, 1), 'f', 1, 64), "m", "ASC"}
	if limit > 0 {
		args = append(args, "COUNT", limit)
	}
	members, err := s.rdb.Do(ctx, args...).StringSlice()
	if err != nil {
		return nil, err
	}
	locs, err := s.LastMany(ctx, members)
	if err != nil {
		return nil, err
	}
	out := locs[:0]
	for _, l := range locs { // GEO hashes are approximate: re-check the exact box
		p := l.GetPosition()
		if p.GetLat() >= swLat && p.GetLat() <= neLat && p.GetLng() >= swLng && p.GetLng() <= neLng {
			out = append(out, l)
		}
	}
	return out, nil
}

func (s *RedisStore) Trim(ctx context.Context, before time.Time) (int, error) {
	stale, err := s.rdb.ZRangeByScore(ctx, KeySeen, &redis.ZRangeBy{Min: "-inf", Max: "(" + strconv.FormatInt(before.UnixMilli(), 10)}).Result()
	if err != nil || len(stale) == 0 {
		return 0, err
	}
	members := make([]any, len(stale))
	for i, m := range stale {
		members[i] = m
	}
	_, err = s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.ZRem(ctx, KeyGeo, members...)
		p.HDel(ctx, KeyLast, stale...)
		p.ZRem(ctx, KeySeen, members...)
		return nil
	})
	return len(stale), err
}
