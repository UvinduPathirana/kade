// Package outbox writes events to the transactional outbox table. Call Insert inside the same
// transaction as the business change; Debezium publishes the row to kade.<aggregatetype>.events
// with headers id, eventType (= type) and traceparent, value = raw protobuf bytes.
package outbox

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/propagation"
	"google.golang.org/protobuf/proto"
)

type Event struct {
	AggregateType string        // "note" → topic kade.note.events
	AggregateID   string        // Kafka key: all events of one aggregate stay ordered on one partition
	Message       proto.Message // the event; its full name becomes `type` / eventType header
}

// Row is what gets stored; exposed for tests and for services that want to log the event id.
type Row struct {
	ID          uuid.UUID
	Type        string
	Payload     []byte
	Traceparent string
}

// Build encodes the event and captures the current trace context.
func Build(ctx context.Context, e Event) (Row, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return Row{}, err
	}
	payload, err := proto.Marshal(e.Message)
	if err != nil {
		return Row{}, fmt.Errorf("encode %T: %w", e.Message, err)
	}
	carrier := propagation.MapCarrier{}
	propagation.TraceContext{}.Inject(ctx, carrier)
	return Row{ID: id, Type: string(proto.MessageName(e.Message)), Payload: payload, Traceparent: carrier.Get("traceparent")}, nil
}

// Insert writes one outbox row in tx and returns the event id.
func Insert(ctx context.Context, tx pgx.Tx, e Event) (uuid.UUID, error) {
	if e.AggregateType == "" || e.AggregateID == "" {
		return uuid.Nil, fmt.Errorf("outbox: aggregate type and id are required")
	}
	row, err := Build(ctx, e)
	if err != nil {
		return uuid.Nil, err
	}
	var tp *string
	if row.Traceparent != "" {
		tp = &row.Traceparent
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO outbox (id, aggregatetype, aggregateid, type, payload, traceparent) VALUES ($1, $2, $3, $4, $5, $6)`,
		row.ID, e.AggregateType, e.AggregateID, row.Type, row.Payload, tp)
	if err != nil {
		return uuid.Nil, fmt.Errorf("outbox insert: %w", err)
	}
	return row.ID, nil
}
