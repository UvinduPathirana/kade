// Package apperr is the one error type handlers return. The gRPC error interceptor turns it into a
// status code plus google.rpc.ErrorInfo{reason, domain, metadata}; gateways map the stable reason
// (e.g. NOTE_NOT_FOUND) to problem+json for the apps.
package apperr

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Error struct {
	Code     codes.Code
	Reason   string // stable, UPPER_SNAKE, part of the API contract
	Message  string // developer-facing; gateways own the user-facing text
	Metadata map[string]string
	Cause    error
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Reason, e.Message, e.Cause)
	}
	return e.Reason + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Cause }

// With adds a metadata entry (copy-on-write so package-level sentinels stay immutable).
func (e *Error) With(k, v string) *Error {
	c := *e
	c.Metadata = map[string]string{k: v}
	for mk, mv := range e.Metadata {
		if mk != k {
			c.Metadata[mk] = mv
		}
	}
	return &c
}

// Wrap attaches an underlying cause (logged, never sent to the caller).
func (e *Error) Wrap(cause error) *Error { c := *e; c.Cause = cause; return &c }

func New(code codes.Code, reason, msg string) *Error {
	return &Error{Code: code, Reason: reason, Message: msg}
}

func InvalidArgument(reason, msg string) *Error { return New(codes.InvalidArgument, reason, msg) }
func NotFound(reason, msg string) *Error        { return New(codes.NotFound, reason, msg) }
func AlreadyExists(reason, msg string) *Error   { return New(codes.AlreadyExists, reason, msg) }
func FailedPrecondition(reason, msg string) *Error {
	return New(codes.FailedPrecondition, reason, msg)
}
func PermissionDenied(reason, msg string) *Error { return New(codes.PermissionDenied, reason, msg) }
func Unauthenticated(reason, msg string) *Error  { return New(codes.Unauthenticated, reason, msg) }
func Unavailable(reason, msg string) *Error      { return New(codes.Unavailable, reason, msg) }

// ToStatus maps any error to a gRPC status. Unknown errors become INTERNAL with no detail leaked.
func ToStatus(err error, domain string) *status.Status {
	if err == nil {
		return status.New(codes.OK, "")
	}
	if s, ok := status.FromError(err); ok && s.Code() != codes.Unknown {
		return s // already a status (e.g. from a downstream call we chose to pass through)
	}
	var ae *Error
	switch {
	case errors.As(err, &ae):
	case errors.Is(err, context.DeadlineExceeded):
		ae = New(codes.DeadlineExceeded, "DEADLINE_EXCEEDED", "deadline exceeded")
	case errors.Is(err, context.Canceled):
		ae = New(codes.Canceled, "CANCELLED", "request cancelled")
	default:
		ae = New(codes.Internal, "INTERNAL", "internal error")
	}
	st := status.New(ae.Code, ae.Message)
	if withInfo, err := st.WithDetails(&errdetails.ErrorInfo{Reason: ae.Reason, Domain: domain, Metadata: ae.Metadata}); err == nil {
		return withInfo
	}
	return st
}

// Reason extracts the ErrorInfo reason from an error returned by a gRPC client call ("" if none).
func Reason(err error) string {
	s, ok := status.FromError(err)
	if !ok {
		return ""
	}
	for _, d := range s.Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok {
			return info.GetReason()
		}
	}
	return ""
}
