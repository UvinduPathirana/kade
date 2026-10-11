// Package config loads the service configuration from environment variables.
// Names follow docs/backend/CONVENTIONS.md so every language reads the same variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServiceName string // SERVICE_NAME: also the OTel service name and Kafka consumer group
	Version     string // SERVICE_VERSION (optional, defaults to "dev")
	GRPCPort    int    // GRPC_PORT
	HTTPPort    int    // HTTP_PORT: /health/*, /metrics

	DatabaseURL  string   // DATABASE_URL (required)
	KafkaBrokers []string // KAFKA_BROKERS: comma-separated; empty disables the consumers
	RedisURL     string   // REDIS_URL (required): the GEO index of available riders
	OTLPEndpoint string   // OTEL_EXPORTER_OTLP_ENDPOINT: empty keeps telemetry local

	LocationGRPC     string // LOCATION_GRPC (optional): simulated riders report positions through location
	NotificationGRPC string // NOTIFICATION_GRPC (optional): rider → customer quick replies

	LogLevel slog.Level // LOG_LEVEL: debug|info|warn|error

	// Topics.
	EventTopics    []string // EVENT_TOPICS (default kade.order.events,kade.ledger.events,kade.review.events)
	LocationsTopic string   // LOCATIONS_TOPIC (default kade.rider.locations); empty disables the GPS consumer

	// Matching.
	OfferTimeout     time.Duration // OFFER_TIMEOUT (30s): how long one rider has to accept
	MatchRadiiKm     []float64     // MATCH_RADII_KM (3,6,12): search rings around the restaurant
	MatchFailAfter   int           // MATCH_FAIL_AFTER (12): empty rounds before DeliveryMatchingFailed
	ReofferAfter     time.Duration // REOFFER_AFTER (2m): a rider who declined/missed may get the same job again after this
	RiderStaleAfter  time.Duration // RIDER_STALE_AFTER (2h): online riders without a position update for longer are skipped
	PreferRealRiders bool          // PREFER_REAL_RIDERS (true): riders with a login (e.g. Nimal) get offers before simulated ones
	MaxEventAge      time.Duration // MAX_EVENT_AGE (6h): older OrderAccepted events (history replay) start no matching

	// Demo fleet.
	SeedOnStart     bool          // SEED_ON_START (true): seeded riders, applications and Nimal's trip history
	SimulateRiders  bool          // SIMULATE_RIDERS (false): seeded riders without logins accept and run their jobs
	SimSecondsPerKm time.Duration // SIM_SECONDS_PER_KM (20s): simulated travel pace
	SimAcceptDelay  time.Duration // SIM_ACCEPT_DELAY (5s)

	RPCTimeout      time.Duration // RPC_DEFAULT_TIMEOUT (default 5s)
	ShutdownTimeout time.Duration // SHUTDOWN_TIMEOUT (default 20s)
	MigrateOnStart  bool          // MIGRATE_ON_START (default true)
}

// Load reads configuration through getenv (os.Getenv in main, a map in tests) and validates it.
func Load(getenv func(string) string) (Config, error) {
	var errs []error
	str := func(key, def string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return def
	}
	port := func(key string) int {
		raw := str(key, "")
		if raw == "" {
			errs = append(errs, fmt.Errorf("%s is required", key))
			return 0
		}
		p, err := strconv.Atoi(raw)
		if err != nil || p < 1 || p > 65535 {
			errs = append(errs, fmt.Errorf("%s=%q is not a valid port", key, raw))
			return 0
		}
		return p
	}
	dur := func(key string, def time.Duration) time.Duration {
		raw := str(key, "")
		if raw == "" {
			return def
		}
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			errs = append(errs, fmt.Errorf("%s=%q is not a positive duration (e.g. 5s)", key, raw))
			return def
		}
		return d
	}
	boolean := func(key string, def bool) bool {
		raw := str(key, "")
		if raw == "" {
			return def
		}
		b, err := strconv.ParseBool(raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s=%q is not a boolean", key, raw))
			return def
		}
		return b
	}
	integer := func(key string, def int) int {
		raw := str(key, "")
		if raw == "" {
			return def
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			errs = append(errs, fmt.Errorf("%s=%q is not a positive integer", key, raw))
			return def
		}
		return n
	}

	c := Config{
		ServiceName:      str("SERVICE_NAME", ""),
		Version:          str("SERVICE_VERSION", "dev"),
		GRPCPort:         port("GRPC_PORT"),
		HTTPPort:         port("HTTP_PORT"),
		DatabaseURL:      str("DATABASE_URL", ""),
		KafkaBrokers:     splitList(getenv("KAFKA_BROKERS")),
		RedisURL:         str("REDIS_URL", ""),
		OTLPEndpoint:     str("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		LocationGRPC:     str("LOCATION_GRPC", ""),
		NotificationGRPC: str("NOTIFICATION_GRPC", ""),
		EventTopics:      splitList(str("EVENT_TOPICS", "kade.order.events,kade.ledger.events,kade.review.events")),
		LocationsTopic:   strings.TrimSpace(getenv("LOCATIONS_TOPIC")),
		OfferTimeout:     dur("OFFER_TIMEOUT", 30*time.Second),
		MatchFailAfter:   integer("MATCH_FAIL_AFTER", 12),
		ReofferAfter:     dur("REOFFER_AFTER", 2*time.Minute),
		RiderStaleAfter:  dur("RIDER_STALE_AFTER", 2*time.Hour),
		PreferRealRiders: boolean("PREFER_REAL_RIDERS", true),
		MaxEventAge:      dur("MAX_EVENT_AGE", 6*time.Hour),
		SeedOnStart:      boolean("SEED_ON_START", true),
		SimulateRiders:   boolean("SIMULATE_RIDERS", false),
		SimSecondsPerKm:  dur("SIM_SECONDS_PER_KM", 20*time.Second),
		SimAcceptDelay:   dur("SIM_ACCEPT_DELAY", 5*time.Second),
		RPCTimeout:       dur("RPC_DEFAULT_TIMEOUT", 5*time.Second),
		ShutdownTimeout:  dur("SHUTDOWN_TIMEOUT", 20*time.Second),
		MigrateOnStart:   boolean("MIGRATE_ON_START", true),
	}
	if getenv("LOCATIONS_TOPIC") == "" {
		c.LocationsTopic = "kade.rider.locations"
	}
	if c.LocationsTopic == "-" {
		c.LocationsTopic = ""
	}
	c.MatchRadiiKm = []float64{3, 6, 12}
	if raw := str("MATCH_RADII_KM", ""); raw != "" {
		c.MatchRadiiKm = nil
		for _, p := range splitList(raw) {
			v, err := strconv.ParseFloat(p, 64)
			if err != nil || v <= 0 {
				errs = append(errs, fmt.Errorf("MATCH_RADII_KM=%q: want positive km, e.g. 3,6,12", raw))
				break
			}
			c.MatchRadiiKm = append(c.MatchRadiiKm, v)
		}
	}

	if c.ServiceName == "" {
		errs = append(errs, errors.New("SERVICE_NAME is required"))
	}
	if c.GRPCPort != 0 && c.GRPCPort == c.HTTPPort {
		errs = append(errs, errors.New("GRPC_PORT and HTTP_PORT must differ"))
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	} else if err := checkURL(c.DatabaseURL, "postgres", "postgresql"); err != nil {
		errs = append(errs, fmt.Errorf("DATABASE_URL: %w", err))
	}
	if c.RedisURL == "" {
		errs = append(errs, errors.New("REDIS_URL is required (GEO index of available riders)"))
	} else if err := checkURL(c.RedisURL, "redis", "rediss"); err != nil {
		errs = append(errs, fmt.Errorf("REDIS_URL: %w", err))
	}
	if c.OTLPEndpoint != "" {
		if err := checkURL(c.OTLPEndpoint, "http", "https"); err != nil {
			errs = append(errs, fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT: %w (use the HTTP endpoint, e.g. http://otel:4318)", err))
		}
	}
	if raw := str("LOG_LEVEL", "info"); raw != "" {
		if err := c.LogLevel.UnmarshalText([]byte(raw)); err != nil {
			errs = append(errs, fmt.Errorf("LOG_LEVEL=%q: want debug|info|warn|error", raw))
		}
	}
	return c, errors.Join(errs...)
}

func splitList(raw string) []string {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func checkURL(raw string, schemes ...string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	for _, s := range schemes {
		if u.Scheme == s && u.Host != "" {
			return nil
		}
	}
	return fmt.Errorf("want %s://host..., got %q", schemes[0], redact(u))
}

// redact hides passwords so validation errors are safe to log.
func redact(u *url.URL) string {
	if u.User != nil {
		if _, ok := u.User.Password(); ok {
			u.User = url.UserPassword(u.User.Username(), "xxxxx")
		}
	}
	return u.String()
}
