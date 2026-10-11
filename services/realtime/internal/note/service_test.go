package note

import (
	"context"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/google/uuid"

	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/realtime/internal/platform/auth"
)

// memStore mimics PgStore's idempotency semantics in memory.
type memStore struct {
	notes map[uuid.UUID]Note
	keys  map[string]struct {
		hash string
		id   uuid.UUID
	}
}

func newMemStore() *memStore {
	return &memStore{notes: map[uuid.UUID]Note{}, keys: map[string]struct {
		hash string
		id   uuid.UUID
	}{}}
}

func (m *memStore) Create(_ context.Context, n Note, idem *Idempotency) (Note, bool, error) {
	if idem != nil {
		if k, ok := m.keys[idem.Key]; ok {
			if k.hash != string(idem.Hash) {
				return Note{}, false, ErrKeyReused
			}
			return m.notes[k.id], true, nil
		}
		m.keys[idem.Key] = struct {
			hash string
			id   uuid.UUID
		}{string(idem.Hash), n.ID}
	}
	m.notes[n.ID] = n
	return n, false, nil
}

func (m *memStore) Get(_ context.Context, id uuid.UUID) (Note, error) {
	n, ok := m.notes[id]
	if !ok {
		return Note{}, ErrNotFound
	}
	return n, nil
}

func user(id string) context.Context {
	return auth.WithIdentity(context.Background(), auth.Identity{UserID: id, Roles: []string{"customer"}})
}

func reason(err error) string {
	if ae, ok := err.(*apperr.Error); ok {
		return ae.Reason
	}
	return ""
}

func TestCreateNoteValidation(t *testing.T) {
	s := NewService(newMemStore(), nil)
	cases := map[string]struct {
		ctx    context.Context
		req    *templatev1.CreateNoteRequest
		reason string
	}{
		"anonymous":     {context.Background(), &templatev1.CreateNoteRequest{Text: "hi"}, "AUTH_REQUIRED"},
		"empty":         {user("u1"), &templatev1.CreateNoteRequest{Text: "   "}, "NOTE_TEXT_REQUIRED"},
		"too long":      {user("u1"), &templatev1.CreateNoteRequest{Text: strings.Repeat("é", 1001)}, "NOTE_TEXT_TOO_LONG"},
		"negative":      {user("u1"), &templatev1.CreateNoteRequest{Text: "hi", Amount: &commonv1.Money{AmountMinor: -1}}, "NOTE_AMOUNT_INVALID"},
		"usd":           {user("u1"), &templatev1.CreateNoteRequest{Text: "hi", Amount: &commonv1.Money{AmountMinor: 1, Currency: "USD"}}, "NOTE_AMOUNT_INVALID"},
		"long idem key": {user("u1"), &templatev1.CreateNoteRequest{Text: "hi", IdempotencyKey: strings.Repeat("k", 201)}, "IDEMPOTENCY_KEY_INVALID"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := s.CreateNote(tc.ctx, tc.req)
			if reason(err) != tc.reason {
				t.Fatalf("err = %v, want reason %s", err, tc.reason)
			}
		})
	}
}

func TestCreateNoteIdempotency(t *testing.T) {
	s := NewService(newMemStore(), nil)
	s.now = func() time.Time { return time.Date(2026, 10, 12, 9, 30, 0, 123456789, time.UTC) }
	req := &templatev1.CreateNoteRequest{Text: " kottu for two ", Amount: &commonv1.Money{AmountMinor: 115000}, IdempotencyKey: "k1"}

	first, err := s.CreateNote(user("u1"), req)
	if err != nil {
		t.Fatal(err)
	}
	if first.Note.Text != "kottu for two" || first.Note.Amount.Currency != "LKR" || first.Note.CreatedAt.AsTime().Nanosecond() != 123456000 {
		t.Fatalf("note = %v", first.Note)
	}
	again, _ := s.CreateNote(user("u1"), req)
	if again.Note.Id != first.Note.Id {
		t.Fatal("retry with the same key created a second note")
	}
	other, _ := s.CreateNote(user("u2"), req)
	if other.Note.Id == first.Note.Id {
		t.Fatal("keys must be scoped per caller")
	}
	changed := &templatev1.CreateNoteRequest{Text: "different", IdempotencyKey: "k1"}
	if _, err := s.CreateNote(user("u1"), changed); reason(err) != "IDEMPOTENCY_KEY_REUSED" {
		t.Fatalf("err = %v", err)
	}
}

func TestGetNote(t *testing.T) {
	var viewed []string
	s := NewService(newMemStore(), func(_ context.Context, n *templatev1.Note) { viewed = append(viewed, n.Id) })
	created, err := s.CreateNote(user("u1"), &templatev1.CreateNoteRequest{Text: "hi"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.GetNote(context.Background(), &templatev1.GetNoteRequest{Id: created.Note.Id})
	if err != nil || got.Note.Text != "hi" {
		t.Fatalf("got %v err %v", got, err)
	}
	if len(viewed) != 1 || viewed[0] != created.Note.Id {
		t.Fatalf("view sink calls = %v", viewed)
	}
	if _, err := s.GetNote(context.Background(), &templatev1.GetNoteRequest{Id: "nope"}); reason(err) != "NOTE_ID_INVALID" {
		t.Fatalf("err = %v", err)
	}
	if _, err := s.GetNote(context.Background(), &templatev1.GetNoteRequest{Id: uuid.NewString()}); reason(err) != "NOTE_NOT_FOUND" {
		t.Fatalf("err = %v", err)
	}
}
