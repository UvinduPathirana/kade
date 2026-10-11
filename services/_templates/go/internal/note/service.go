package note

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	templatev1 "github.com/UvinduPathirana/kade/gen/go/kade/template/v1"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/_templates/go/internal/platform/apperr"
	"github.com/UvinduPathirana/kade/services/_templates/go/internal/platform/auth"
	"github.com/UvinduPathirana/kade/services/_templates/go/internal/platform/idempotency"
)

// Stable error reasons (part of the API contract; gateways map them to user-facing messages).
var (
	errAuthRequired  = apperr.Unauthenticated("AUTH_REQUIRED", "x-user-id metadata is required")
	errTextRequired  = apperr.InvalidArgument("NOTE_TEXT_REQUIRED", "text is required")
	errTextTooLong   = apperr.InvalidArgument("NOTE_TEXT_TOO_LONG", "text must be at most 1000 characters")
	errBadAmount     = apperr.InvalidArgument("NOTE_AMOUNT_INVALID", "amount must be non-negative LKR minor units")
	errBadID         = apperr.InvalidArgument("NOTE_ID_INVALID", "id must be a UUID")
	errNotFound      = apperr.NotFound("NOTE_NOT_FOUND", "note not found")
	errKeyReused     = apperr.FailedPrecondition("IDEMPOTENCY_KEY_REUSED", "idempotency_key was already used for a different request")
	errKeyTooLong    = apperr.InvalidArgument("IDEMPOTENCY_KEY_INVALID", "idempotency_key must be at most 200 characters")
	maxTextRunes     = 1000
	maxIdemKeyLength = 200
)

// ViewSink receives a note every time it is read (the template's direct-produce stream demo).
type ViewSink func(ctx context.Context, n *templatev1.Note)

type Service struct {
	templatev1.UnimplementedTemplateServiceServer
	store Store
	views ViewSink
	now   func() time.Time
}

func NewService(store Store, views ViewSink) *Service {
	return &Service{store: store, views: views, now: time.Now}
}

func (s *Service) CreateNote(ctx context.Context, req *templatev1.CreateNoteRequest) (*templatev1.CreateNoteResponse, error) {
	caller := auth.FromContext(ctx)
	if !caller.Authenticated() {
		return nil, errAuthRequired
	}
	text := strings.TrimSpace(req.GetText())
	switch {
	case text == "":
		return nil, errTextRequired
	case utf8.RuneCountInString(text) > maxTextRunes:
		return nil, errTextTooLong
	case req.GetAmount().GetAmountMinor() < 0, req.GetAmount() != nil && req.GetAmount().GetCurrency() != "" && req.GetAmount().GetCurrency() != "LKR":
		return nil, errBadAmount
	case len(req.GetIdempotencyKey()) > maxIdemKeyLength:
		return nil, errKeyTooLong
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	n := Note{
		ID:          id,
		Text:        text,
		AmountMinor: req.GetAmount().GetAmountMinor(),
		Currency:    "LKR",
		AuthorID:    caller.UserID,
		CreatedAt:   s.now().UTC().Truncate(time.Microsecond), // Postgres precision
	}
	var idem *Idempotency
	if key := req.GetIdempotencyKey(); key != "" {
		// Scope keys per caller so two users can't collide, and hash the request without the key.
		fp := proto.Clone(req).(*templatev1.CreateNoteRequest)
		fp.IdempotencyKey = ""
		idem = &Idempotency{Key: caller.UserID + ":" + key, Hash: idempotency.Hash(fp)}
	}
	out, _, err := s.store.Create(ctx, n, idem)
	if errors.Is(err, ErrKeyReused) {
		return nil, errKeyReused
	}
	if err != nil {
		return nil, err
	}
	return &templatev1.CreateNoteResponse{Note: ToProto(out)}, nil
}

func (s *Service) GetNote(ctx context.Context, req *templatev1.GetNoteRequest) (*templatev1.GetNoteResponse, error) {
	id, err := uuid.Parse(req.GetId())
	if err != nil {
		return nil, errBadID.With("id", req.GetId())
	}
	n, err := s.store.Get(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return nil, errNotFound.With("note_id", id.String())
	}
	if err != nil {
		return nil, err
	}
	p := ToProto(n)
	if s.views != nil {
		s.views(ctx, p) // async, never fails the read
	}
	return &templatev1.GetNoteResponse{Note: p}, nil
}

func ToProto(n Note) *templatev1.Note {
	return &templatev1.Note{
		Id:        n.ID.String(),
		Text:      n.Text,
		Amount:    &commonv1.Money{AmountMinor: n.AmountMinor, Currency: n.Currency},
		CreatedAt: timestamppb.New(n.CreatedAt),
	}
}

func FromProto(p *templatev1.Note) Note {
	id, _ := uuid.Parse(p.GetId())
	return Note{
		ID:          id,
		Text:        p.GetText(),
		AmountMinor: p.GetAmount().GetAmountMinor(),
		Currency:    p.GetAmount().GetCurrency(),
		CreatedAt:   p.GetCreatedAt().AsTime(),
	}
}
