// Package note is the template's example domain: replace it with your service's own.
// It shows the full write path (validation → one tx: row + outbox + idempotency key) and the
// read side (GetNote → registry-encoded stream message, NoteCreated consumer → Redis → WebSocket).
package note

import (
	"context"
	"errors"
	"fmt"
	"time"

	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"

	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/idempotency"
	"github.com/UvinduPathirana/kade/services/dispatch/internal/platform/outbox"
)

type Note struct {
	ID          uuid.UUID
	Text        string
	AmountMinor int64
	Currency    string
	AuthorID    string
	CreatedAt   time.Time
}

// Idempotency carries a client key and the request fingerprint.
type Idempotency struct {
	Key  string
	Hash []byte
}

var (
	ErrNotFound  = errors.New("note not found")
	ErrKeyReused = idempotency.ErrKeyReused
)

// Store is what the gRPC service needs; PgStore implements it, tests fake it.
type Store interface {
	// Create inserts n and its NoteCreated outbox event atomically. With idem set, a repeat call
	// returns the originally created note (replayed=true) instead of creating a second one.
	Create(ctx context.Context, n Note, idem *Idempotency) (out Note, replayed bool, err error)
	Get(ctx context.Context, id uuid.UUID) (Note, error)
}

type PgStore struct{ pool *pgxpool.Pool }

func NewPgStore(pool *pgxpool.Pool) *PgStore { return &PgStore{pool: pool} }

const idemScope = "CreateNote"

func (s *PgStore) Create(ctx context.Context, n Note, idem *Idempotency) (Note, bool, error) {
	out, replayed := n, false
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if idem != nil {
			prior, replay, err := idempotency.Claim(ctx, tx, idemScope, idem.Key, idem.Hash)
			if err != nil {
				return err
			}
			if replay {
				var resp templatev1.CreateNoteResponse
				if err := proto.Unmarshal(prior, &resp); err != nil {
					return fmt.Errorf("decode stored response: %w", err)
				}
				out, replayed = FromProto(resp.GetNote()), true
				return nil
			}
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO notes (id, text, amount_minor, currency, author_id, created_at) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)`,
			n.ID, n.Text, n.AmountMinor, n.Currency, n.AuthorID, n.CreatedAt); err != nil {
			return fmt.Errorf("insert note: %w", err)
		}
		p := ToProto(n)
		if _, err := outbox.Insert(ctx, tx, outbox.Event{
			AggregateType: "note",
			AggregateID:   n.ID.String(),
			Message:       &templatev1.NoteCreated{NoteId: p.Id, Text: p.Text, Amount: p.Amount, CreatedAt: p.CreatedAt},
		}); err != nil {
			return err
		}
		if idem != nil {
			return idempotency.Complete(ctx, tx, idemScope, idem.Key, &templatev1.CreateNoteResponse{Note: p})
		}
		return nil
	})
	return out, replayed, err
}

func (s *PgStore) Get(ctx context.Context, id uuid.UUID) (Note, error) {
	n := Note{ID: id}
	var author *string
	err := s.pool.QueryRow(ctx, `SELECT text, amount_minor, currency, author_id, created_at FROM notes WHERE id = $1`, id).
		Scan(&n.Text, &n.AmountMinor, &n.Currency, &author, &n.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	if author != nil {
		n.AuthorID = *author
	}
	return n, err
}

// MarkEventSeen is the consumer's side effect (projection demo): runs in the consumer's tx.
func MarkEventSeen(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE notes SET last_event_at = now() WHERE id = $1`, id)
	return err
}
