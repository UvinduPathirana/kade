package positions

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"time"

	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/location/internal/platform/apperr"
)

var (
	errRiderRequired = apperr.InvalidArgument("RIDER_ID_REQUIRED", "rider_id is required")
	errQueryRequired = apperr.InvalidArgument("LOCATION_QUERY_REQUIRED", "give rider_ids or both corners of a box")
	errTooMany       = apperr.InvalidArgument("LOCATION_BATCH_TOO_LARGE", "at most 500 locations per call")
)

const maxBatch = 500

// Sink produces accepted fixes to kade.rider.locations, keyed by rider id. It blocks when the
// producer buffer is full: that is the backpressure the stream handler passes on to the gateway.
type Sink func(ctx context.Context, loc *locationv1.RiderLocation)

type Service struct {
	locationv1.UnimplementedLocationServiceServer
	filter *Filter
	store  Store
	sink   Sink
	ttl    time.Duration
	log    *slog.Logger
	now    func() time.Time

	counter metric.Int64Counter
}

func NewService(filter *Filter, store Store, sink Sink, lastKnownTTL time.Duration, log *slog.Logger) *Service {
	c, _ := otel.Meter("kade/location").Int64Counter("kade.location.positions",
		metric.WithDescription("Rider fixes received, by outcome (accepted, invalid, duplicate, implausible)"))
	return &Service{filter: filter, store: store, sink: sink, ttl: lastKnownTTL, log: log, now: time.Now, counter: c}
}

// Ingest filters, produces and stores a batch; returns how many were accepted and dropped.
func (s *Service) Ingest(ctx context.Context, locs []*locationv1.RiderLocation) (accepted, dropped int64) {
	now := s.now()
	keep := make([]*locationv1.RiderLocation, 0, len(locs))
	for _, l := range locs {
		if l == nil {
			dropped++
			continue
		}
		if reason := s.filter.Accept(l, now); reason != "" {
			dropped++
			s.counter.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", reason)))
			continue
		}
		if l.GetOccurredAt() == nil || !l.GetOccurredAt().IsValid() || l.GetOccurredAt().AsTime().After(now) {
			l.OccurredAt = timestamppb.New(now)
		}
		l.ReceivedAt = timestamppb.New(now)
		if s.sink != nil {
			s.sink(ctx, l)
		}
		keep = append(keep, l)
		accepted++
	}
	if len(keep) > 0 {
		s.counter.Add(ctx, int64(len(keep)), metric.WithAttributes(attribute.String("outcome", "accepted")))
		// Losing a ping is fine (the next one is a second away): log, never fail the stream.
		if err := s.store.Save(ctx, keep); err != nil {
			s.log.WarnContext(ctx, "saving last known positions failed", "err", err, "count", len(keep))
		}
	}
	return accepted, dropped
}

func (s *Service) StreamRiderLocations(stream grpc.ClientStreamingServer[locationv1.StreamRiderLocationsRequest, locationv1.StreamRiderLocationsResponse]) error {
	ctx := stream.Context()
	var accepted, dropped int64
	for {
		req, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return stream.SendAndClose(&locationv1.StreamRiderLocationsResponse{Accepted: accepted, Dropped: dropped})
		}
		if err != nil {
			return err
		}
		a, d := s.Ingest(ctx, []*locationv1.RiderLocation{req.GetLocation()})
		accepted += a
		dropped += d
	}
}

func (s *Service) ReportRiderLocations(ctx context.Context, req *locationv1.ReportRiderLocationsRequest) (*locationv1.ReportRiderLocationsResponse, error) {
	if len(req.GetLocations()) > maxBatch {
		return nil, errTooMany
	}
	a, d := s.Ingest(ctx, req.GetLocations())
	return &locationv1.ReportRiderLocationsResponse{Accepted: a, Dropped: d}, nil
}

func (s *Service) GetLastKnownLocation(ctx context.Context, req *locationv1.GetLastKnownLocationRequest) (*locationv1.GetLastKnownLocationResponse, error) {
	if req.GetRiderId() == "" {
		return nil, errRiderRequired
	}
	l, err := s.store.Last(ctx, req.GetRiderId())
	if err != nil {
		return nil, err
	}
	if l == nil || s.now().Sub(l.GetReceivedAt().AsTime()) > s.ttl {
		return &locationv1.GetLastKnownLocationResponse{}, nil
	}
	return &locationv1.GetLastKnownLocationResponse{Location: l}, nil
}

func (s *Service) BatchGetLastKnownLocations(ctx context.Context, req *locationv1.BatchGetLastKnownLocationsRequest) (*locationv1.BatchGetLastKnownLocationsResponse, error) {
	var (
		locs []*locationv1.RiderLocation
		err  error
	)
	sw, ne := req.GetSouthWest(), req.GetNorthEast()
	switch {
	case len(req.GetRiderIds()) > maxBatch:
		return nil, errTooMany
	case len(req.GetRiderIds()) > 0:
		locs, err = s.store.LastMany(ctx, req.GetRiderIds())
	case sw != nil && ne != nil && ValidPoint(sw.GetLat(), sw.GetLng()) && ValidPoint(ne.GetLat(), ne.GetLng()):
		locs, err = s.store.InBox(ctx, min(sw.GetLat(), ne.GetLat()), min(sw.GetLng(), ne.GetLng()),
			max(sw.GetLat(), ne.GetLat()), max(sw.GetLng(), ne.GetLng()), maxBatch)
	default:
		return nil, errQueryRequired
	}
	if err != nil {
		return nil, err
	}
	since := s.now().Add(-s.ttl)
	if req.GetSince() != nil && req.GetSince().IsValid() {
		since = req.GetSince().AsTime()
	}
	out := make([]*locationv1.RiderLocation, 0, len(locs))
	for _, l := range locs {
		if !l.GetReceivedAt().AsTime().Before(since) {
			out = append(out, l)
		}
	}
	return &locationv1.BatchGetLastKnownLocationsResponse{Locations: out}, nil
}

// RunJanitor trims positions older than retain from Redis and prunes the in-memory filter, every
// interval, until ctx ends.
func (s *Service) RunJanitor(ctx context.Context, interval, retain time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			now := s.now()
			if n, err := s.store.Trim(ctx, now.Add(-retain)); err != nil {
				s.log.WarnContext(ctx, "trimming old positions failed", "err", err)
			} else if n > 0 {
				s.log.InfoContext(ctx, "trimmed old positions", "riders", n)
			}
			s.filter.Prune(now.Add(-time.Hour))
		}
	}
}
