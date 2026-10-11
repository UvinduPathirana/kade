package note

import (
	"context"
	"fmt"
	"log/slog"

	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/encoding/protojson"

	"github.com/UvinduPathirana/kade/services/location/internal/platform/kafka"
)

// Publisher pushes a payload to every WebSocket client watching channel (ws.Hub implements it).
type Publisher interface {
	Publish(ctx context.Context, channel string, payload []byte) error
}

// Channel is the WebSocket/Redis channel for one note.
func Channel(noteID string) string { return "note:" + noteID }

// RegisterHandlers wires the note consumers. pub may be nil (no Redis).
func RegisterHandlers(r *kafka.Router, pub Publisher, log *slog.Logger) {
	kafka.Handle(r, func(ctx context.Context, tx pgx.Tx, d *kafka.Delivery, e *templatev1.NoteCreated) error {
		id, err := uuid.Parse(e.GetNoteId())
		if err != nil {
			return kafka.Permanent(fmt.Errorf("note_id %q: %w", e.GetNoteId(), err))
		}
		if err := MarkEventSeen(ctx, tx, id); err != nil {
			return err // transient: retried with backoff, then DLQ
		}
		if pub != nil {
			// Redis is not part of the transaction: publish only after commit.
			d.AfterCommit(func(ctx context.Context) {
				payload, _ := protojson.Marshal(e)
				msg := fmt.Appendf(nil, `{"type":%q,"eventId":%q,"data":%s}`, d.EventType, d.EventID, payload)
				if err := pub.Publish(ctx, Channel(e.GetNoteId()), msg); err != nil {
					log.WarnContext(ctx, "publish to websocket channel failed", "err", err)
				}
			})
		}
		return nil
	})
}
