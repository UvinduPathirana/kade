package views

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"time"

	dispatchv1 "github.com/UvinduPathirana/kade/gen/go/kade/dispatch/v1"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Colombo is Asia/Colombo (UTC+5:30, no DST): "today" on the ops dashboard.
var Colombo = time.FixedZone("Asia/Colombo", 5*3600+1800)

// Ops counter keys:
//
//	ops:active               set of non-final order ids          → in_progress
//	ops:due                  zset order id → due_at (unix s)     → late (due_at < now)
//	ops:waiting              set of delivery ids without a rider → waiting_for_rider
//	ops:riders               set of online / on-job rider ids    → riders_online
//	ops:attention            hash id → AttentionItem bytes       → attention
//	ops:d:<yyyymmdd>:placed  set of order ids placed that day    → orders_today
//	ops:d:<yyyymmdd>:cancel  set of cancelled/rejected order ids → cancellations_today
//	ops:d:<yyyymmdd>:hours   hash hour → count                   → orders_by_hour
//	ops:d:<yyyymmdd>:done    set of delivered order ids, plus ops:d:<day>:avg hash sum/count
//	ops:dirty                set when anything changed; the ops publisher GETDELs it
const dayTTL = 8 * 24 * time.Hour

func (s *Store) dayKey(t time.Time, name string) string {
	return s.key("ops", "d", t.In(Colombo).Format("20060102"), name)
}

// OpsOrderOpen counts a placed order (once per day) and tracks it as in progress when active.
func (s *Store) OpsOrderOpen(ctx context.Context, orderID string, placedAt time.Time, active bool, dueAt time.Time) error {
	placed := s.dayKey(placedAt, "placed")
	added, err := s.rdb.SAdd(ctx, placed, orderID).Result()
	if err != nil {
		return err
	}
	_, err = s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Expire(ctx, placed, dayTTL)
		if added == 1 {
			hours := s.dayKey(placedAt, "hours")
			p.HIncrBy(ctx, hours, strconv.Itoa(placedAt.In(Colombo).Hour()), 1)
			p.Expire(ctx, hours, dayTTL)
		}
		if active {
			p.SAdd(ctx, s.key("ops", "active"), orderID)
			if !dueAt.IsZero() {
				p.ZAdd(ctx, s.key("ops", "due"), redis.Z{Score: float64(dueAt.Unix()), Member: orderID})
			}
		}
		p.Set(ctx, s.key("ops", "dirty"), 1, 0)
		return nil
	})
	return err
}

// OpsOrderFinished removes a final order; cancelled ones count towards cancellations_today and
// delivered ones towards the average delivery time.
func (s *Store) OpsOrderFinished(ctx context.Context, orderID string, at time.Time, cancelled bool, deliveryMinutes float64) error {
	var done int64
	if deliveryMinutes > 0 {
		var err error
		if done, err = s.rdb.SAdd(ctx, s.dayKey(at, "done"), orderID).Result(); err != nil {
			return err
		}
	}
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.SRem(ctx, s.key("ops", "active"), orderID)
		p.ZRem(ctx, s.key("ops", "due"), orderID)
		if cancelled {
			k := s.dayKey(at, "cancel")
			p.SAdd(ctx, k, orderID)
			p.Expire(ctx, k, dayTTL)
		}
		if done == 1 {
			avg := s.dayKey(at, "avg")
			p.HIncrByFloat(ctx, avg, "sum", deliveryMinutes)
			p.HIncrBy(ctx, avg, "count", 1)
			p.Expire(ctx, avg, dayTTL)
			p.Expire(ctx, s.dayKey(at, "done"), dayTTL)
		}
		p.Set(ctx, s.key("ops", "dirty"), 1, 0)
		return nil
	})
	return err
}

// OpsWaiting marks a delivery as waiting for a rider (or not).
func (s *Store) OpsWaiting(ctx context.Context, deliveryID string, waiting bool) error {
	return s.setMember(ctx, "waiting", deliveryID, waiting)
}

// OpsRiderOnline marks a rider online/on job (or offline/suspended).
func (s *Store) OpsRiderOnline(ctx context.Context, riderID string, online bool) error {
	return s.setMember(ctx, "riders", riderID, online)
}

func (s *Store) setMember(ctx context.Context, set, member string, in bool) error {
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		if in {
			p.SAdd(ctx, s.key("ops", set), member)
		} else {
			p.SRem(ctx, s.key("ops", set), member)
		}
		p.Set(ctx, s.key("ops", "dirty"), 1, 0)
		return nil
	})
	return err
}

// OpsAttention adds or replaces an attention item.
func (s *Store) OpsAttention(ctx context.Context, item *dispatchv1.AttentionItem) error {
	b, err := proto.Marshal(item)
	if err != nil {
		return err
	}
	_, err = s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.HSet(ctx, s.key("ops", "attention"), item.GetId(), b)
		p.Set(ctx, s.key("ops", "dirty"), 1, 0)
		return nil
	})
	return err
}

// OpsClearAttention removes attention items by id.
func (s *Store) OpsClearAttention(ctx context.Context, ids ...string) error {
	n, err := s.rdb.HDel(ctx, s.key("ops", "attention"), ids...).Result()
	if err == nil && n > 0 {
		err = s.MarkOpsDirty(ctx)
	}
	return err
}

func (s *Store) MarkOpsDirty(ctx context.Context) error {
	return s.rdb.Set(ctx, s.key("ops", "dirty"), 1, 0).Err()
}

// TakeOpsDirty returns true (once, across replicas) when counters changed since the last call.
func (s *Store) TakeOpsDirty(ctx context.Context) (bool, error) {
	err := s.rdb.GetDel(ctx, s.key("ops", "dirty")).Err()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	return err == nil, err
}

// OpsSnapshot reads the counters into a LiveSnapshot (no dots or zones: those come from dispatch's
// GetLiveSnapshot on load and from rider position frames).
func (s *Store) OpsSnapshot(ctx context.Context, now time.Time) (*dispatchv1.LiveSnapshot, error) {
	var (
		active, waiting, riders, placed, cancel *redis.IntCmd
		late                                    *redis.IntCmd
		hours, avg                              *redis.MapStringStringCmd
		attention                               *redis.MapStringStringCmd
	)
	_, err := s.rdb.Pipelined(ctx, func(p redis.Pipeliner) error {
		active = p.SCard(ctx, s.key("ops", "active"))
		waiting = p.SCard(ctx, s.key("ops", "waiting"))
		riders = p.SCard(ctx, s.key("ops", "riders"))
		placed = p.SCard(ctx, s.dayKey(now, "placed"))
		cancel = p.SCard(ctx, s.dayKey(now, "cancel"))
		late = p.ZCount(ctx, s.key("ops", "due"), "-inf", strconv.FormatInt(now.Unix(), 10))
		hours = p.HGetAll(ctx, s.dayKey(now, "hours"))
		avg = p.HGetAll(ctx, s.dayKey(now, "avg"))
		attention = p.HGetAll(ctx, s.key("ops", "attention"))
		return nil
	})
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	snap := &dispatchv1.LiveSnapshot{
		At:                 timestamppb.New(now),
		InProgress:         int32(active.Val()),
		WaitingForRider:    int32(waiting.Val()),
		Late:               int32(late.Val()),
		RidersOnline:       int32(riders.Val()),
		OrdersToday:        int32(placed.Val()),
		CancellationsToday: int32(cancel.Val()),
	}
	for h := 0; h <= now.In(Colombo).Hour(); h++ {
		n, _ := strconv.Atoi(hours.Val()[strconv.Itoa(h)])
		snap.OrdersByHour = append(snap.OrdersByHour, &dispatchv1.HourCount{Hour: int32(h), Today: int32(n)})
	}
	if count, _ := strconv.ParseFloat(avg.Val()["count"], 64); count > 0 {
		sum, _ := strconv.ParseFloat(avg.Val()["sum"], 64)
		snap.AvgDeliveryMinutes = float64(int(sum/count*10+0.5)) / 10
	}
	for _, b := range attention.Val() {
		item := &dispatchv1.AttentionItem{}
		if proto.Unmarshal([]byte(b), item) == nil {
			snap.Attention = append(snap.Attention, item)
		}
	}
	sort.Slice(snap.Attention, func(i, j int) bool {
		a, b := snap.Attention[i], snap.Attention[j]
		if a.GetSeverity() != b.GetSeverity() {
			return a.GetSeverity() > b.GetSeverity()
		}
		return a.GetId() < b.GetId()
	})
	return snap, nil
}
