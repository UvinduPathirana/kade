package kafka

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/protobuf/proto"
)

// Delivery describes the record being handled.
type Delivery struct {
	EventID   uuid.UUID
	EventType string
	Record    *kgo.Record

	afterCommit []func(context.Context)
}

// AfterCommit registers fn to run once the handler's transaction has committed (e.g. publish to
// Redis, call a non-transactional API). It runs at most once per successfully handled event.
func (d *Delivery) AfterCommit(fn func(context.Context)) { d.afterCommit = append(d.afterCommit, fn) }

type route struct {
	decode func([]byte) (proto.Message, error)
	handle func(context.Context, pgx.Tx, *Delivery, proto.Message) error
}

// Router maps eventType (fully-qualified proto name) to a typed handler.
type Router struct{ routes map[string]route }

func NewRouter() *Router { return &Router{routes: map[string]route{}} }

// Handle registers fn for events of type T. Side effects must use tx: it is the same transaction
// that records the event id in processed_events, so a redelivery is a no-op.
//
//	kafka.Handle(router, func(ctx context.Context, tx pgx.Tx, d *kafka.Delivery, e *orderv1.OrderPlaced) error { ... })
func Handle[T proto.Message](r *Router, fn func(context.Context, pgx.Tx, *Delivery, T) error) {
	var zero T
	name := string(proto.MessageName(zero))
	r.routes[name] = route{
		decode: func(b []byte) (proto.Message, error) {
			m := zero.ProtoReflect().Type().New().Interface()
			return m, proto.Unmarshal(b, m)
		},
		handle: func(ctx context.Context, tx pgx.Tx, d *Delivery, m proto.Message) error {
			return fn(ctx, tx, d, m.(T))
		},
	}
}

// Types lists the registered event types.
func (r *Router) Types() []string {
	out := make([]string, 0, len(r.routes))
	for t := range r.routes {
		out = append(out, t)
	}
	return out
}

// permanentError skips retries and goes straight to the DLQ.
type permanentError struct{ err error }

func (p permanentError) Error() string { return "permanent: " + p.err.Error() }
func (p permanentError) Unwrap() error { return p.err }

// Permanent marks err as not worth retrying (bad payload, violated invariant). Return it from a
// handler to dead-letter the event immediately.
func Permanent(err error) error { return permanentError{err} }

func IsPermanent(err error) bool { var p permanentError; return errors.As(err, &p) }

// prepare validates headers and decodes the payload. ok=false means "not for us, skip".
func (r *Router) prepare(rec *kgo.Record) (route, *Delivery, proto.Message, bool, error) {
	typ := Header(rec, HeaderEventType)
	rt, ok := r.routes[typ]
	if !ok {
		return route{}, nil, nil, false, nil // other event types on the topic: forward compatible
	}
	id, err := uuid.Parse(Header(rec, HeaderEventID))
	if err != nil {
		return rt, nil, nil, true, Permanent(fmt.Errorf("missing or invalid %q header: %w", HeaderEventID, err))
	}
	msg, err := rt.decode(rec.Value)
	if err != nil {
		return rt, nil, nil, true, Permanent(fmt.Errorf("decode %s: %w", typ, err))
	}
	return rt, &Delivery{EventID: id, EventType: typ, Record: rec}, msg, true, nil
}
