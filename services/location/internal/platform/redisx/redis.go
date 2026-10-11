// Package redisx wires go-redis v9 (traced and metered with redisotel) and provides the two Redis
// patterns the Go services need: a GEO index (dispatch) and pub/sub fan-out (realtime).
package redisx

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/extra/redisotel/v9"
	"github.com/redis/go-redis/v9"
)

// Open connects to REDIS_URL (redis://host:6379/0) and verifies the connection.
func Open(ctx context.Context, url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	opts.PoolSize = 10
	opts.ReadTimeout = 2 * time.Second
	opts.WriteTimeout = 2 * time.Second
	rdb := redis.NewClient(opts)
	if err := redisotel.InstrumentTracing(rdb); err != nil {
		return nil, err
	}
	if err := redisotel.InstrumentMetrics(rdb); err != nil {
		return nil, err
	}
	for attempt := 1; ; attempt++ {
		pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = rdb.Ping(pctx).Err()
		cancel()
		if err == nil {
			return rdb, nil
		}
		if attempt == 10 || ctx.Err() != nil {
			_ = rdb.Close()
			return nil, fmt.Errorf("redis not reachable: %w", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
}
