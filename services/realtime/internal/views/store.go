// Package views is realtime's only state: small projections in Redis, rebuilt from the event
// streams, so frames can carry whole objects (an Order, a kitchen Ticket, a Delivery) even when
// the event only carries the fields that changed, and so Subscribe can be authorised.
//
// Keys (all under the configured prefix, default "rt:"; every key has a TTL):
//
//	v:order:<id>        Order snapshot (proto bytes)        v:ticket:<order_id>  merchant Ticket
//	v:delivery:<id>     dispatch Delivery                   v:od:<order_id>      delivery id
//	own:order:<id>      hash customer/outlet/rider          own:group:<id>       set of member customer ids
//	own:ticket:<id>     support requester id                offer:<rider_id>     open offer (hash offer, delivery)
//	offerd:<delivery>   rider holding the open offer        seen:<event_id>      consumer dedup (24 h)
//	thr:<key>           throttle gates (SET NX PX)          pos:seq:<rider_id>   last position sequence
//	ops:*               dashboard counters (ops.go)
//
// Updates are read-modify-write under WATCH, so two replicas handling events of the same order
// from different topics (order vs delivery partitions) never lose each other's changes.
package views

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	merchantv1 "github.com/UvinduPathirana/kade/gen/go/kade/merchant/v1"
	orderv1 "github.com/UvinduPathirana/kade/gen/go/kade/order/v1"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/proto"

	"github.com/UvinduPathirana/kade/services/realtime/internal/channel"
)

const dedupTTL = 24 * time.Hour

type Store struct {
	rdb    *redis.Client
	prefix string
	ttl    time.Duration
}

func New(rdb *redis.Client, prefix string, ttl time.Duration) *Store {
	return &Store{rdb: rdb, prefix: prefix, ttl: ttl}
}

func (s *Store) key(parts ...string) string { return s.prefix + strings.Join(parts, ":") }

// ---------- consumer dedup (kafka.Deduper) ----------

func (s *Store) Claim(ctx context.Context, eventID string) (bool, error) {
	return s.rdb.SetNX(ctx, s.key("seen", eventID), 1, dedupTTL).Result()
}

func (s *Store) Release(ctx context.Context, eventID string) error {
	return s.rdb.Del(ctx, s.key("seen", eventID)).Err()
}

// ---------- proto projections ----------

// update applies fn to the stored message (a fresh one when absent) and writes it back when fn
// returns true. It retries when another writer changed the key in between.
func update[T proto.Message](ctx context.Context, s *Store, key string, fresh func() T, fn func(v T, exists bool) bool) (T, bool, error) {
	var out T
	var changed bool
	txf := func(tx *redis.Tx) error {
		v := fresh()
		b, err := tx.Get(ctx, key).Bytes()
		exists := err == nil
		if err != nil && !errors.Is(err, redis.Nil) {
			return err
		}
		if exists {
			if err := proto.Unmarshal(b, v); err != nil {
				return fmt.Errorf("decode %s: %w", key, err)
			}
		}
		out, changed = v, fn(v, exists)
		if !changed {
			return nil
		}
		nb, err := proto.Marshal(v)
		if err != nil {
			return err
		}
		_, err = tx.TxPipelined(ctx, func(p redis.Pipeliner) error {
			p.Set(ctx, key, nb, s.ttl)
			return nil
		})
		return err
	}
	for range 20 {
		err := s.rdb.Watch(ctx, txf, key)
		if errors.Is(err, redis.TxFailedErr) {
			continue
		}
		return out, changed, err
	}
	return out, false, fmt.Errorf("update %s: too much contention", key)
}

func get[T proto.Message](ctx context.Context, s *Store, key string, v T) (bool, error) {
	b, err := s.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, proto.Unmarshal(b, v)
}

// UpdateOrder changes the order snapshot. fn returns false to leave it untouched.
func (s *Store) UpdateOrder(ctx context.Context, id string, fn func(o *orderv1.Order, exists bool) bool) (*orderv1.Order, bool, error) {
	return update(ctx, s, s.key("v", "order", id), func() *orderv1.Order { return &orderv1.Order{} }, fn)
}

func (s *Store) Order(ctx context.Context, id string) (*orderv1.Order, bool, error) {
	o := &orderv1.Order{}
	ok, err := get(ctx, s, s.key("v", "order", id), o)
	return o, ok, err
}

// UpdateTicket changes the kitchen ticket of an order.
func (s *Store) UpdateTicket(ctx context.Context, orderID string, fn func(t *merchantv1.Ticket, exists bool) bool) (*merchantv1.Ticket, bool, error) {
	return update(ctx, s, s.key("v", "ticket", orderID), func() *merchantv1.Ticket { return &merchantv1.Ticket{} }, fn)
}

// UpdateDelivery changes the delivery view.
func (s *Store) UpdateDelivery(ctx context.Context, id string, fn func(d *dispatchv1.Delivery, exists bool) bool) (*dispatchv1.Delivery, bool, error) {
	return update(ctx, s, s.key("v", "delivery", id), func() *dispatchv1.Delivery { return &dispatchv1.Delivery{} }, fn)
}

func (s *Store) Delivery(ctx context.Context, id string) (*dispatchv1.Delivery, bool, error) {
	d := &dispatchv1.Delivery{}
	ok, err := get(ctx, s, s.key("v", "delivery", id), d)
	return d, ok, err
}

func (s *Store) SetOrderDelivery(ctx context.Context, orderID, deliveryID string) error {
	return s.rdb.Set(ctx, s.key("v", "od", orderID), deliveryID, s.ttl).Err()
}

// OrderDelivery returns the delivery id of an order ("" when unknown).
func (s *Store) OrderDelivery(ctx context.Context, orderID string) (string, error) {
	id, err := s.rdb.Get(ctx, s.key("v", "od", orderID)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return id, err
}

// ---------- ownership (channel.Owners) ----------

func (s *Store) OrderAccess(ctx context.Context, orderID string) (channel.OrderAccess, bool, error) {
	m, err := s.rdb.HGetAll(ctx, s.key("own", "order", orderID)).Result()
	if err != nil || len(m) == 0 {
		return channel.OrderAccess{}, false, err
	}
	return channel.OrderAccess{CustomerID: m["customer"], OutletID: m["outlet"], RiderID: m["rider"]}, true, nil
}

// SaveOrderAccess records the non-empty owners (it never clears a field; see SetOrderRider).
func (s *Store) SaveOrderAccess(ctx context.Context, orderID string, a channel.OrderAccess) error {
	var kv []any
	for k, v := range map[string]string{"customer": a.CustomerID, "outlet": a.OutletID, "rider": a.RiderID} {
		if v != "" {
			kv = append(kv, k, v)
		}
	}
	if len(kv) == 0 {
		return nil
	}
	key := s.key("own", "order", orderID)
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.HSet(ctx, key, kv...)
		p.Expire(ctx, key, s.ttl)
		return nil
	})
	return err
}

// SetOrderRider sets (or with "" clears) the rider who may watch the order.
func (s *Store) SetOrderRider(ctx context.Context, orderID, riderID string) error {
	if riderID != "" {
		return s.SaveOrderAccess(ctx, orderID, channel.OrderAccess{RiderID: riderID})
	}
	return s.rdb.HDel(ctx, s.key("own", "order", orderID), "rider").Err()
}

func (s *Store) GroupMembers(ctx context.Context, groupID string) ([]string, error) {
	return s.rdb.SMembers(ctx, s.key("own", "group", groupID)).Result()
}

// SetGroupMembers replaces the customer ids allowed on group:<id>.
func (s *Store) SetGroupMembers(ctx context.Context, groupID string, customerIDs []string) error {
	key := s.key("own", "group", groupID)
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Del(ctx, key)
		var members []any
		for _, id := range customerIDs {
			if id != "" {
				members = append(members, id)
			}
		}
		if len(members) > 0 {
			p.SAdd(ctx, key, members...)
			p.Expire(ctx, key, s.ttl)
		}
		return nil
	})
	return err
}

func (s *Store) TicketRequester(ctx context.Context, ticketID string) (string, error) {
	id, err := s.rdb.Get(ctx, s.key("own", "ticket", ticketID)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return id, err
}

// SetTicketRequester records who opened a support ticket. Tickets live longer than orders.
func (s *Store) SetTicketRequester(ctx context.Context, ticketID, requesterID string) error {
	if requesterID == "" {
		return nil
	}
	return s.rdb.Set(ctx, s.key("own", "ticket", ticketID), requesterID, 30*24*time.Hour).Err()
}

// ---------- rider offers ----------

// SetOpenOffer remembers the offer showing on a rider's phone (until it is answered or expires).
func (s *Store) SetOpenOffer(ctx context.Context, riderID, offerID, deliveryID string, ttl time.Duration) error {
	key := s.key("offer", riderID)
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Del(ctx, key)
		p.HSet(ctx, key, "offer", offerID, "delivery", deliveryID)
		p.Expire(ctx, key, ttl)
		p.Set(ctx, s.key("offerd", deliveryID), riderID, ttl)
		return nil
	})
	return err
}

// OpenOffer returns the rider's open offer ("" when none).
func (s *Store) OpenOffer(ctx context.Context, riderID string) (offerID, deliveryID string, err error) {
	m, err := s.rdb.HGetAll(ctx, s.key("offer", riderID)).Result()
	return m["offer"], m["delivery"], err
}

// OfferHolder returns the rider holding the open offer for a delivery ("" when none).
func (s *Store) OfferHolder(ctx context.Context, deliveryID string) (string, error) {
	id, err := s.rdb.Get(ctx, s.key("offerd", deliveryID)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return id, err
}

func (s *Store) ClearOpenOffer(ctx context.Context, riderID, deliveryID string) error {
	return s.rdb.Del(ctx, s.key("offer", riderID), s.key("offerd", deliveryID)).Err()
}

// ---------- throttling ----------

// Allow returns true at most once per interval per key, across every replica.
func (s *Store) Allow(ctx context.Context, key string, every time.Duration) (bool, error) {
	return s.rdb.SetNX(ctx, s.key("thr", key), 1, every).Result()
}

var newerScript = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '-1')
if tonumber(ARGV[1]) <= cur then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 3600)
return 1`)

// NewerPosition records seq for a rider and reports whether it is newer than the last one seen.
func (s *Store) NewerPosition(ctx context.Context, riderID string, seq int64) (bool, error) {
	n, err := newerScript.Run(ctx, s.rdb, []string{s.key("pos", "seq", riderID)}, seq).Int()
	return n == 1, err
}
