package redisx

import (
	"context"

	"github.com/redis/go-redis/v9"
)

type Message struct {
	Channel string
	Payload []byte
}

// Broker is the pub/sub surface the WebSocket hub needs. One Broker per process holds a single
// Redis connection; channels are subscribed while at least one local client wants them.
type Broker interface {
	Publish(ctx context.Context, channel string, payload []byte) error
	Subscribe(ctx context.Context, channels ...string) error
	Unsubscribe(ctx context.Context, channels ...string) error
	Messages() <-chan Message
	Close() error
}

type redisBroker struct {
	rdb *redis.Client
	ps  *redis.PubSub
	out chan Message
}

// NewBroker starts the shared subscription connection.
func NewBroker(ctx context.Context, rdb *redis.Client) Broker {
	b := &redisBroker{rdb: rdb, ps: rdb.Subscribe(ctx), out: make(chan Message, 256)}
	go func() {
		defer close(b.out)
		for m := range b.ps.Channel(redis.WithChannelSize(256)) {
			b.out <- Message{Channel: m.Channel, Payload: []byte(m.Payload)}
		}
	}()
	return b
}

func (b *redisBroker) Publish(ctx context.Context, channel string, payload []byte) error {
	return b.rdb.Publish(ctx, channel, payload).Err()
}
func (b *redisBroker) Subscribe(ctx context.Context, ch ...string) error {
	return b.ps.Subscribe(ctx, ch...)
}
func (b *redisBroker) Unsubscribe(ctx context.Context, ch ...string) error {
	return b.ps.Unsubscribe(ctx, ch...)
}
func (b *redisBroker) Messages() <-chan Message { return b.out }
func (b *redisBroker) Close() error             { return b.ps.Close() }
