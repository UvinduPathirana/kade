package positions

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
	locationv1 "github.com/UvinduPathirana/kade/gen/go/kade/location/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/UvinduPathirana/kade/services/location/internal/platform/apperr"
)

var t0 = time.Date(2026, 10, 12, 9, 30, 0, 0, time.UTC)

// Kollupitiya junction and a point ~110 m north of it.
const lat0, lng0 = 6.9110, 79.8490

func fix(rider string, seq int64, lat, lng float64, at time.Time) *locationv1.RiderLocation {
	return &locationv1.RiderLocation{RiderId: rider, Sequence: seq, Position: &commonv1.GeoPoint{Lat: lat, Lng: lng}, OccurredAt: timestamppb.New(at)}
}

func TestFilter(t *testing.T) {
	f := NewFilter(50)
	cases := []struct {
		name string
		loc  *locationv1.RiderLocation
		now  time.Time
		want string
	}{
		{"first fix", fix("r1", 1, lat0, lng0, t0), t0, ""},
		{"no rider", fix("", 1, lat0, lng0, t0), t0, DropInvalid},
		{"null island", fix("r2", 1, 0, 0, t0), t0, DropInvalid},
		{"no position", &locationv1.RiderLocation{RiderId: "r2"}, t0, DropInvalid},
		{"same sequence", fix("r1", 1, lat0+0.001, lng0, t0.Add(time.Second)), t0.Add(time.Second), DropDuplicate},
		{"older sequence", fix("r1", 0, lat0+0.001, lng0, t0.Add(-time.Second)), t0.Add(time.Second), DropDuplicate},
		{"next fix", fix("r1", 2, lat0+0.001, lng0, t0.Add(time.Second)), t0.Add(time.Second), ""},
		{"teleport", fix("r1", 3, lat0+0.1, lng0, t0.Add(2*time.Second)), t0.Add(2 * time.Second), DropImplausible},
		{"teleport 2", fix("r1", 4, lat0+0.1, lng0, t0.Add(3*time.Second)), t0.Add(3 * time.Second), DropImplausible},
		{"teleport 3", fix("r1", 5, lat0+0.1, lng0, t0.Add(4*time.Second)), t0.Add(4 * time.Second), DropImplausible},
		{"persistent new place wins", fix("r1", 6, lat0+0.1, lng0, t0.Add(5*time.Second)), t0.Add(5 * time.Second), ""},
		{"silent rider may reappear anywhere", fix("r1", 7, lat0, lng0, t0.Add(10*time.Minute)), t0.Add(10 * time.Minute), ""},
	}
	for _, tc := range cases {
		if got := f.Accept(tc.loc, tc.now); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if n := f.Prune(t0.Add(time.Hour)); n != 1 || f.Len() != 0 {
		t.Errorf("prune removed %d, left %d", n, f.Len())
	}
}

type memStore struct {
	last map[string]*locationv1.RiderLocation
}

func (m *memStore) Save(_ context.Context, locs []*locationv1.RiderLocation) error {
	for _, l := range locs {
		m.last[l.GetRiderId()] = l
	}
	return nil
}
func (m *memStore) Last(_ context.Context, id string) (*locationv1.RiderLocation, error) {
	return m.last[id], nil
}
func (m *memStore) LastMany(_ context.Context, ids []string) ([]*locationv1.RiderLocation, error) {
	var out []*locationv1.RiderLocation
	for _, id := range ids {
		if l, ok := m.last[id]; ok {
			out = append(out, l)
		}
	}
	return out, nil
}
func (m *memStore) InBox(_ context.Context, swLat, swLng, neLat, neLng float64, _ int) ([]*locationv1.RiderLocation, error) {
	var out []*locationv1.RiderLocation
	for _, l := range m.last {
		p := l.GetPosition()
		if p.Lat >= swLat && p.Lat <= neLat && p.Lng >= swLng && p.Lng <= neLng {
			out = append(out, l)
		}
	}
	return out, nil
}
func (m *memStore) Trim(context.Context, time.Time) (int, error) { return 0, nil }

func newService(produced *[]string) (*Service, *memStore) {
	st := &memStore{last: map[string]*locationv1.RiderLocation{}}
	s := NewService(NewFilter(50), st, func(_ context.Context, l *locationv1.RiderLocation) {
		*produced = append(*produced, l.GetRiderId())
	}, 30*time.Minute, slog.New(slog.DiscardHandler))
	s.now = func() time.Time { return t0 }
	return s, st
}

// fakeStream feeds requests to StreamRiderLocations.
type fakeStream struct {
	grpc.ServerStream
	in  []*locationv1.StreamRiderLocationsRequest
	out *locationv1.StreamRiderLocationsResponse
}

func (f *fakeStream) Context() context.Context     { return context.Background() }
func (f *fakeStream) SetHeader(metadata.MD) error  { return nil }
func (f *fakeStream) SendHeader(metadata.MD) error { return nil }
func (f *fakeStream) SetTrailer(metadata.MD)       {}
func (f *fakeStream) Recv() (*locationv1.StreamRiderLocationsRequest, error) {
	if len(f.in) == 0 {
		return nil, io.EOF
	}
	r := f.in[0]
	f.in = f.in[1:]
	return r, nil
}
func (f *fakeStream) SendAndClose(r *locationv1.StreamRiderLocationsResponse) error {
	f.out = r
	return nil
}

func TestStreamAndQueries(t *testing.T) {
	var produced []string
	s, st := newService(&produced)
	stream := &fakeStream{in: []*locationv1.StreamRiderLocationsRequest{
		{Location: fix("r1", 1, lat0, lng0, t0.Add(-2*time.Second))},
		{Location: fix("r1", 1, lat0, lng0, t0.Add(-2*time.Second))}, // duplicate
		{Location: fix("r1", 2, lat0+0.0005, lng0, t0.Add(-time.Second))},
		{Location: fix("r2", 1, 6.89, 79.856, t0.Add(time.Hour))}, // device clock ahead: clamped to now
		{},
	}}
	if err := s.StreamRiderLocations(stream); err != nil {
		t.Fatal(err)
	}
	if stream.out.Accepted != 3 || stream.out.Dropped != 2 {
		t.Fatalf("response = %v", stream.out)
	}
	if len(produced) != 3 || produced[0] != "r1" {
		t.Fatalf("produced = %v", produced)
	}
	if got := st.last["r2"].GetOccurredAt().AsTime(); !got.Equal(t0) {
		t.Errorf("future occurred_at not clamped: %v", got)
	}

	got, err := s.GetLastKnownLocation(context.Background(), &locationv1.GetLastKnownLocationRequest{RiderId: "r1"})
	if err != nil || got.GetLocation().GetSequence() != 2 || !got.GetLocation().GetReceivedAt().AsTime().Equal(t0) {
		t.Fatalf("last = %v err %v", got, err)
	}
	s.now = func() time.Time { return t0.Add(time.Hour) }
	if got, _ := s.GetLastKnownLocation(context.Background(), &locationv1.GetLastKnownLocationRequest{RiderId: "r1"}); got.GetLocation() != nil {
		t.Error("stale position should be unset")
	}
	s.now = func() time.Time { return t0 }
	if _, err := s.GetLastKnownLocation(context.Background(), &locationv1.GetLastKnownLocationRequest{}); reason(err) != "RIDER_ID_REQUIRED" {
		t.Errorf("err = %v", err)
	}

	batch, _ := s.BatchGetLastKnownLocations(context.Background(), &locationv1.BatchGetLastKnownLocationsRequest{RiderIds: []string{"r1", "r2", "nobody"}})
	if len(batch.GetLocations()) != 2 {
		t.Errorf("by ids = %v", batch.GetLocations())
	}
	box, _ := s.BatchGetLastKnownLocations(context.Background(), &locationv1.BatchGetLastKnownLocationsRequest{
		SouthWest: &commonv1.GeoPoint{Lat: 6.90, Lng: 79.84}, NorthEast: &commonv1.GeoPoint{Lat: 6.92, Lng: 79.86},
	})
	if len(box.GetLocations()) != 1 || box.GetLocations()[0].GetRiderId() != "r1" {
		t.Errorf("box = %v", box.GetLocations())
	}
	if _, err := s.BatchGetLastKnownLocations(context.Background(), &locationv1.BatchGetLastKnownLocationsRequest{}); reason(err) != "LOCATION_QUERY_REQUIRED" {
		t.Errorf("err = %v", err)
	}
}

func reason(err error) string {
	if ae, ok := err.(*apperr.Error); ok {
		return ae.Reason
	}
	return ""
}
