package kafka

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Deduper records handled event ids (realtime keeps them in Redis with a TTL: it has no database).
// Claim returns false when the id was already claimed; Release undoes a claim whose handling failed.
type Deduper interface {
	Claim(ctx context.Context, eventID string) (bool, error)
	Release(ctx context.Context, eventID string) error
}

// RawHandler handles records of a topic that is not an outbox stream (no id/eventType headers),
// e.g. kade.rider.locations. Errors are logged and the record skipped: losing a GPS ping is fine.
type RawHandler func(ctx context.Context, rec *kgo.Record) error

type ConsumerOptions struct {
	Brokers []string
	Group   string   // one group shared by every replica
	Topics  []string // e.g. kade.order.events
	Dedup   Deduper
	Router  *Router
	Raw     map[string]RawHandler // topic → handler, bypasses Router/Dedup/DLQ
	DLQ     *kgo.Client           // producer client used for <topic>.dlq
	Logger  *slog.Logger

	MaxAttempts int                             // default 5 (CONVENTIONS)
	Backoff     func(attempt int) time.Duration // default 200ms·2^(n-1), capped at 5s
	ExtraOpts   []kgo.Opt
}

// Consumer runs the idempotent-consumer loop. Partitions are processed concurrently, records
// within a partition strictly in order. Offsets are committed only for fully handled records.
type Consumer struct {
	cl     *kgo.Client
	o      ConsumerOptions
	log    *slog.Logger
	tracer trace.Tracer

	sendDLQ func(context.Context, *kgo.Record) error
	sleep   func(context.Context, time.Duration) error

	events   metric.Int64Counter
	duration metric.Float64Histogram
}

func NewConsumer(o ConsumerOptions) (*Consumer, error) {
	if o.Group == "" || len(o.Topics) == 0 || o.Dedup == nil || o.Router == nil || o.DLQ == nil {
		return nil, errors.New("kafka consumer: group, topics, deduper, router and DLQ client are required")
	}
	if o.MaxAttempts <= 0 {
		o.MaxAttempts = 5
	}
	if o.Backoff == nil {
		o.Backoff = ExpBackoff(200*time.Millisecond, 5*time.Second)
	}
	c := &Consumer{o: o, log: o.Logger.With("component", "kafka-consumer"), tracer: otel.Tracer("kade/kafka")}
	opts := []kgo.Opt{
		kgo.SeedBrokers(o.Brokers...),
		kgo.ClientID(o.Group),
		kgo.ConsumerGroup(o.Group),
		kgo.ConsumeTopics(o.Topics...),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()), // a new group replays history
		kgo.BlockRebalanceOnPoll(),                        // no partition moves mid-batch
		kgo.AutoCommitMarks(),                             // commit only what we marked as handled
		kgo.OnPartitionsRevoked(func(ctx context.Context, cl *kgo.Client, _ map[string][]int32) {
			if err := cl.CommitMarkedOffsets(ctx); err != nil {
				c.log.WarnContext(ctx, "commit on revoke failed", "err", err)
			}
		}),
		kgo.WithLogger(Logger(c.log)),
		// Bounded fetch memory (franz-go defaults to 50 MB per fetch).
		kgo.FetchMaxBytes(4 << 20),
		kgo.FetchMaxPartitionBytes(1 << 20),
	}
	cl, err := kgo.NewClient(append(opts, o.ExtraOpts...)...)
	if err != nil {
		return nil, err
	}
	c.cl = cl
	c.sendDLQ = c.produceDLQ
	c.sleep = sleepCtx
	if err := c.initMetrics(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Consumer) initMetrics() (err error) {
	m := otel.Meter("kade/kafka")
	if c.events, err = m.Int64Counter("kade.consumer.events", metric.WithDescription("Consumed events by outcome")); err != nil {
		return err
	}
	c.duration, err = m.Float64Histogram("kade.consumer.duration", metric.WithUnit("s"), metric.WithDescription("Event handling time incl. retries"))
	return err
}

func (c *Consumer) Client() *kgo.Client { return c.cl }

// Run polls until ctx is cancelled, then commits what was handled and leaves the group.
func (c *Consumer) Run(ctx context.Context) error {
	defer c.cl.CloseAllowingRebalance()
	for {
		fetches := c.cl.PollRecords(ctx, 500)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			c.commit()
			return nil
		}
		fetches.EachError(func(topic string, p int32, err error) {
			if !errors.Is(err, context.Canceled) {
				c.log.WarnContext(ctx, "fetch error", "topic", topic, "partition", p, "err", err)
			}
		})
		var wg sync.WaitGroup
		fetches.EachPartition(func(p kgo.FetchTopicPartition) {
			if len(p.Records) == 0 {
				return
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				for _, rec := range p.Records {
					if !c.process(ctx, rec) {
						return // shutting down: leave the rest uncommitted for the next owner
					}
					c.cl.MarkCommitRecords(rec)
				}
			}()
		})
		wg.Wait()
		c.commit()
		c.cl.AllowRebalance()
	}
}

func (c *Consumer) commit() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.cl.CommitMarkedOffsets(ctx); err != nil {
		c.log.Warn("commit failed", "err", err)
	}
}

// process handles one record to completion (handled, duplicate, skipped or dead-lettered).
// It returns false only when ctx was cancelled before the outcome was durable.
func (c *Consumer) process(ctx context.Context, rec *kgo.Record) bool {
	start := time.Now()
	pctx := otel.GetTextMapPropagator().Extract(ctx, HeaderCarrier{rec})
	pctx, span := c.tracer.Start(pctx, rec.Topic+" process", trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "kafka"),
			attribute.String("messaging.destination.name", rec.Topic),
			attribute.Int("messaging.destination.partition.id", int(rec.Partition)),
			attribute.Int64("messaging.kafka.offset", rec.Offset),
			attribute.String("messaging.kafka.message.key", string(rec.Key)),
			attribute.String("messaging.message.type", Header(rec, HeaderEventType)),
		))
	defer span.End()

	outcome, err := c.handle(pctx, rec)
	if outcome == "cancelled" {
		span.SetStatus(codes.Error, "cancelled")
		return false
	}
	if outcome == "dlq" {
		span.SetStatus(codes.Error, "dead-lettered: "+err.Error())
	}
	span.SetAttributes(attribute.String("kade.outcome", outcome))
	attrs := metric.WithAttributes(attribute.String("topic", rec.Topic), attribute.String("type", Header(rec, HeaderEventType)), attribute.String("outcome", outcome))
	c.events.Add(ctx, 1, attrs)
	c.duration.Record(ctx, time.Since(start).Seconds(), attrs)
	return true
}

// handle returns the outcome: processed | duplicate | skipped | dlq (err = the cause) | cancelled.
func (c *Consumer) handle(ctx context.Context, rec *kgo.Record) (string, error) {
	if raw, ok := c.o.Raw[rec.Topic]; ok {
		if err := raw(ctx, rec); err != nil {
			if ctx.Err() != nil {
				return "cancelled", ctx.Err()
			}
			c.log.DebugContext(ctx, "raw record skipped", "topic", rec.Topic, "offset", rec.Offset, "err", err)
			return "skipped", nil
		}
		return "processed", nil
	}
	rt, d, msg, ok, err := c.o.Router.prepare(rec)
	if !ok {
		return "skipped", nil
	}
	attempt := 0
	claimed := false
	for err == nil {
		attempt++
		if !claimed {
			var fresh bool
			if fresh, err = c.o.Dedup.Claim(ctx, d.EventID.String()); err == nil {
				if !fresh {
					c.log.DebugContext(ctx, "duplicate event skipped", "event_id", d.EventID, "type", d.EventType)
					return "duplicate", nil
				}
				claimed = true
			}
		}
		if err == nil {
			if err = rt.handle(ctx, d, msg); err == nil {
				return "processed", nil
			}
		}
		if ctx.Err() != nil {
			c.release(d)
			return "cancelled", ctx.Err()
		}
		if IsPermanent(err) || attempt >= c.o.MaxAttempts {
			break
		}
		c.log.WarnContext(ctx, "event handling failed, retrying", "event_id", d.EventID, "type", d.EventType, "attempt", attempt, "err", err)
		if serr := c.sleep(ctx, c.o.Backoff(attempt)); serr != nil {
			c.release(d)
			return "cancelled", serr
		}
		err = nil
	}
	if claimed {
		c.release(d) // a replay from the DLQ must be handled again
	}
	// Dead-letter: copy the record, add error headers, keep retrying the DLQ write until it lands.
	if attempt == 0 {
		attempt = 1
	}
	dlq := &kgo.Record{Topic: rec.Topic + ".dlq", Key: rec.Key, Value: rec.Value, Headers: append([]kgo.RecordHeader(nil), rec.Headers...)}
	for k, v := range map[string]string{
		HeaderError:             err.Error(),
		HeaderAttempts:          strconv.Itoa(attempt),
		HeaderOriginalTopic:     rec.Topic,
		HeaderOriginalPartition: strconv.Itoa(int(rec.Partition)),
		HeaderOriginalOffset:    strconv.FormatInt(rec.Offset, 10),
		HeaderFailedBy:          c.o.Group,
	} {
		HeaderCarrier{dlq}.Set(k, v)
	}
	otel.GetTextMapPropagator().Inject(ctx, HeaderCarrier{dlq})
	c.log.ErrorContext(ctx, "event dead-lettered", "dlq", dlq.Topic, "topic", rec.Topic, "partition", rec.Partition, "offset", rec.Offset,
		"type", Header(rec, HeaderEventType), "event_id", Header(rec, HeaderEventID), "attempts", attempt, "err", err)
	for try := 1; ; try++ {
		derr := c.sendDLQ(ctx, dlq)
		if derr == nil {
			return "dlq", err
		}
		if ctx.Err() != nil {
			return "cancelled", ctx.Err()
		}
		c.log.ErrorContext(ctx, "DLQ produce failed, retrying", "try", try, "err", derr)
		if serr := c.sleep(ctx, c.o.Backoff(try)); serr != nil {
			return "cancelled", serr
		}
	}
}

func (c *Consumer) release(d *Delivery) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.o.Dedup.Release(ctx, d.EventID.String()); err != nil {
		c.log.Warn("dedup release failed", "event_id", d.EventID, "err", err)
	}
}

func (c *Consumer) produceDLQ(ctx context.Context, rec *kgo.Record) error {
	return c.o.DLQ.ProduceSync(ctx, rec).FirstErr()
}

// ExpBackoff doubles from base up to max.
func ExpBackoff(base, max time.Duration) func(int) time.Duration {
	return func(attempt int) time.Duration {
		d := base
		for i := 1; i < attempt && d < max; i++ {
			d *= 2
		}
		return min(d, max)
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
