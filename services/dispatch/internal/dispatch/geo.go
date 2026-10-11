package dispatch

import (
	"math"
	"time"

	commonv1 "github.com/UvinduPathirana/kade/gen/go/kade/common/v1"
)

// Colombo has no daylight saving: a fixed +05:30 zone avoids depending on tzdata.
var Colombo = time.FixedZone("Asia/Colombo", 5*3600+30*60)

// Zone is a delivery zone as the admin console shows it. pricing.ResolveZone is the source of
// truth for orders; dispatch only needs centres to label rider positions and the ops map, so it
// keeps a copy of pricing's seed (services/pricing/drizzle/0001_seed.sql).
type Zone struct {
	ID, Code, Name string
	Lat, Lng       float64
	RidersNeeded   int32
}

var Zones = []Zone{
	{"c15", "Colombo 15", "Mattakkuliya", 6.965, 79.87, 1},
	{"c14", "Colombo 14", "Grandpass", 6.948, 79.876, 1},
	{"c13", "Colombo 13", "Kotahena", 6.946, 79.862, 1},
	{"c01", "Colombo 01", "Fort", 6.9344, 79.8428, 2},
	{"c11", "Colombo 11", "Pettah", 6.9375, 79.852, 1},
	{"c12", "Colombo 12", "Hulftsdorp", 6.942, 79.859, 1},
	{"c10", "Colombo 10", "Maradana", 6.929, 79.865, 1},
	{"c09", "Colombo 09", "Dematagoda", 6.935, 79.88, 1},
	{"c02", "Colombo 02", "Slave Island", 6.922, 79.85, 2},
	{"c08", "Colombo 08", "Borella", 6.915, 79.878, 2},
	{"raj", "Rajagiriya", "Rajagiriya", 6.909, 79.896, 1},
	{"c03", "Colombo 03", "Kollupitiya", 6.91, 79.851, 6},
	{"c07", "Colombo 07", "Cinnamon Gardens", 6.908, 79.865, 3},
	{"c04", "Colombo 04", "Bambalapitiya", 6.893, 79.856, 4},
	{"c05", "Colombo 05", "Havelock Town", 6.883, 79.868, 2},
	{"nug", "Nugegoda", "Nugegoda", 6.872, 79.889, 1},
	{"c06", "Colombo 06", "Wellawatte", 6.874, 79.861, 4},
	{"deh", "Dehiwala", "Dehiwala", 6.851, 79.865, 2},
	{"mtl", "Mount Lavinia", "Mount Lavinia", 6.833, 79.865, 1},
}

var zoneByID = func() map[string]Zone {
	m := make(map[string]Zone, len(Zones))
	for _, z := range Zones {
		m[z.ID] = z
	}
	return m
}()

func ZoneByID(id string) (Zone, bool) { z, ok := zoneByID[id]; return z, ok }

// ZoneOf returns the zone whose centre is nearest, within 3.5 km (CONVENTIONS), or "".
func ZoneOf(p *commonv1.GeoPoint) string {
	if !validPoint(p) {
		return ""
	}
	best, bestKm := "", 3.5
	for _, z := range Zones {
		if km := HaversineKm(p.GetLat(), p.GetLng(), z.Lat, z.Lng); km <= bestKm {
			best, bestKm = z.ID, km
		}
	}
	return best
}

func validPoint(p *commonv1.GeoPoint) bool {
	return p != nil && !(p.GetLat() == 0 && p.GetLng() == 0) && !math.IsNaN(p.GetLat()) && !math.IsNaN(p.GetLng()) &&
		p.GetLat() >= -85 && p.GetLat() <= 85 && p.GetLng() >= -180 && p.GetLng() <= 180
}

// HaversineKm is the great-circle distance in km.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * 6371.0088 * math.Asin(math.Min(1, math.Sqrt(h)))
}

// RoadFactor turns straight-line km into a road estimate (Colombo's grid is roughly 1.3×).
const RoadFactor = 1.3

// RoadKm estimates the road distance between two points, rounded to 0.1 km.
func RoadKm(a, b *commonv1.GeoPoint) float64 {
	if !validPoint(a) || !validPoint(b) {
		return 0
	}
	return round1(HaversineKm(a.GetLat(), a.GetLng(), b.GetLat(), b.GetLng()) * RoadFactor)
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// RiderSpeedKmh is the planning speed for a motorbike in Colombo traffic.
const RiderSpeedKmh = 20.0

// TravelMinutes is the time to ride km at RiderSpeedKmh, at least 1 minute.
func TravelMinutes(km float64) int32 {
	return int32(max(1, math.Ceil(km/RiderSpeedKmh*60)))
}

// Lerp moves from a towards b by fraction f (0..1); fine for the few km of a city trip.
func Lerp(a, b *commonv1.GeoPoint, f float64) *commonv1.GeoPoint {
	f = math.Max(0, math.Min(1, f))
	return &commonv1.GeoPoint{Lat: a.GetLat() + (b.GetLat()-a.GetLat())*f, Lng: a.GetLng() + (b.GetLng()-a.GetLng())*f}
}

// MapPoint converts the apps' illustrated-map units to WGS84 (CONVENTIONS "Map units").
func MapPoint(x, y float64) *commonv1.GeoPoint {
	return &commonv1.GeoPoint{Lat: 6.94570 - 0.00007126*y, Lng: 79.82772 + 0.00006806*x}
}
