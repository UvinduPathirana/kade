package apperr

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestToStatus(t *testing.T) {
	notFound := NotFound("NOTE_NOT_FOUND", "no such note")
	cases := []struct {
		name   string
		err    error
		code   codes.Code
		reason string
	}{
		{"app error", notFound.With("note_id", "n1"), codes.NotFound, "NOTE_NOT_FOUND"},
		{"wrapped app error", fmt.Errorf("get: %w", notFound), codes.NotFound, "NOTE_NOT_FOUND"},
		{"deadline", fmt.Errorf("db: %w", context.DeadlineExceeded), codes.DeadlineExceeded, "DEADLINE_EXCEEDED"},
		{"canceled", context.Canceled, codes.Canceled, "CANCELLED"},
		{"unknown", errors.New("pq: secret detail"), codes.Internal, "INTERNAL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := ToStatus(tc.err, "dispatch")
			if st.Code() != tc.code {
				t.Fatalf("code = %v, want %v", st.Code(), tc.code)
			}
			if got := Reason(st.Err()); got != tc.reason {
				t.Fatalf("reason = %q, want %q", got, tc.reason)
			}
			if st.Message() == "pq: secret detail" {
				t.Fatal("internal error message leaked")
			}
			info := st.Details()[0].(*errdetails.ErrorInfo)
			if info.Domain != "dispatch" {
				t.Fatalf("domain = %q", info.Domain)
			}
		})
	}
	if md := ToStatus(notFound.With("note_id", "n1"), "d").Details()[0].(*errdetails.ErrorInfo).Metadata; md["note_id"] != "n1" {
		t.Fatalf("metadata = %v", md)
	}
	if notFound.Metadata != nil {
		t.Fatal("With mutated the sentinel")
	}
}

func TestToStatusPassesThroughStatus(t *testing.T) {
	in := status.Error(codes.Unavailable, "downstream")
	if got := ToStatus(in, "d").Code(); got != codes.Unavailable {
		t.Fatalf("code = %v", got)
	}
}
