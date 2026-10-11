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
	ServiceName string // SERVICE_NAME: also the OTel service name
	Version     string // SERVICE_VERSION (optional, defaults to "dev")
	GRPCPort    int    // GRPC_PORT
	HTTPPort    int    // HTTP_PORT: /health/*, /metrics

	KafkaBrokers      []string // KAFKA_BROKERS (required): kade.rider.locations is produced directly
	SchemaRegistryURL string   // SCHEMA_REGISTRY_URL (required): Confluent Protobuf wire format
	RedisURL          string   // REDIS_URL (required): last known positions
	OTLPEndpoint      string   // OTEL_EXPORTER_OTLP_ENDPOINT: empty keeps telemetry local

	LogLevel slog.Level // LOG_LEVEL: debug|info|warn|error

	StreamTopic     string        // STREAM_TOPIC (default kade.rider.locations)
	LastKnownTTL    time.Duration // LAST_KNOWN_TTL (default 30m): older positions count as "not reported recently"
	RetainPositions time.Duration // RETAIN_POSITIONS (default 6h): positions older than this are removed from Redis
	MaxSpeedMPS     float64       // MAX_SPEED_MPS (default 50 ≈ 180 km/h): faster jumps are dropped as implausible
	RPCTimeout      time.Duration // RPC_DEFAULT_TIMEOUT (default 5s)
	ShutdownTimeout time.Duration // SHUTDOWN_TIMEOUT (default 20s)
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

	c := Config{
		ServiceName:       str("SERVICE_NAME", ""),
		Version:           str("SERVICE_VERSION", "dev"),
		GRPCPort:          port("GRPC_PORT"),
		HTTPPort:          port("HTTP_PORT"),
		KafkaBrokers:      splitList(getenv("KAFKA_BROKERS")),
		SchemaRegistryURL: str("SCHEMA_REGISTRY_URL", ""),
		RedisURL:          str("REDIS_URL", ""),
		OTLPEndpoint:      str("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		StreamTopic:       str("STREAM_TOPIC", "kade.rider.locations"),
		LastKnownTTL:      dur("LAST_KNOWN_TTL", 30*time.Minute),
		RetainPositions:   dur("RETAIN_POSITIONS", 6*time.Hour),
		MaxSpeedMPS:       50,
		RPCTimeout:        dur("RPC_DEFAULT_TIMEOUT", 5*time.Second),
		ShutdownTimeout:   dur("SHUTDOWN_TIMEOUT", 20*time.Second),
	}
	if raw := str("MAX_SPEED_MPS", ""); raw != "" {
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil || v <= 0 {
			errs = append(errs, fmt.Errorf("MAX_SPEED_MPS=%q is not a positive number", raw))
		} else {
			c.MaxSpeedMPS = v
		}
	}

	if c.ServiceName == "" {
		errs = append(errs, errors.New("SERVICE_NAME is required"))
	}
	if c.GRPCPort != 0 && c.GRPCPort == c.HTTPPort {
		errs = append(errs, errors.New("GRPC_PORT and HTTP_PORT must differ"))
	}
	if len(c.KafkaBrokers) == 0 {
		errs = append(errs, errors.New("KAFKA_BROKERS is required (positions are produced to kade.rider.locations)"))
	}
	if c.SchemaRegistryURL == "" {
		errs = append(errs, errors.New("SCHEMA_REGISTRY_URL is required"))
	} else if err := checkURL(c.SchemaRegistryURL, "http", "https"); err != nil {
		errs = append(errs, fmt.Errorf("SCHEMA_REGISTRY_URL: %w", err))
	}
	if c.RedisURL == "" {
		errs = append(errs, errors.New("REDIS_URL is required (last known positions)"))
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
