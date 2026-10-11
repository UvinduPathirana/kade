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
	HTTPPort    int    // HTTP_PORT: /health/*, /metrics, /ws

	DatabaseURL       string   // DATABASE_URL (required)
	KafkaBrokers      []string // KAFKA_BROKERS: comma-separated; empty disables Kafka
	SchemaRegistryURL string   // SCHEMA_REGISTRY_URL: empty disables the registry-encoded stream producer
	RedisURL          string   // REDIS_URL: empty disables Redis (GEO + WebSocket hub)
	OTLPEndpoint      string   // OTEL_EXPORTER_OTLP_ENDPOINT: empty keeps telemetry local (stdout logs, /metrics)

	LogLevel slog.Level // LOG_LEVEL: debug|info|warn|error

	// Template-specific knobs. Real services keep the ones they need.
	NoteEventsTopic string        // NOTE_EVENTS_TOPIC (default kade.note.events): consumed idempotently
	StreamTopic     string        // STREAM_TOPIC (default kade.note.views): registry-encoded direct produce demo
	RPCTimeout      time.Duration // RPC_DEFAULT_TIMEOUT (default 5s): server-side cap when the caller sent no deadline
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

	c := Config{
		ServiceName:       str("SERVICE_NAME", ""),
		Version:           str("SERVICE_VERSION", "dev"),
		GRPCPort:          port("GRPC_PORT"),
		HTTPPort:          port("HTTP_PORT"),
		DatabaseURL:       str("DATABASE_URL", ""),
		KafkaBrokers:      splitList(getenv("KAFKA_BROKERS")),
		SchemaRegistryURL: str("SCHEMA_REGISTRY_URL", ""),
		RedisURL:          str("REDIS_URL", ""),
		OTLPEndpoint:      str("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		NoteEventsTopic:   str("NOTE_EVENTS_TOPIC", "kade.note.events"),
		StreamTopic:       str("STREAM_TOPIC", "kade.note.views"),
		RPCTimeout:        dur("RPC_DEFAULT_TIMEOUT", 5*time.Second),
		ShutdownTimeout:   dur("SHUTDOWN_TIMEOUT", 20*time.Second),
		MigrateOnStart:    true,
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
	if c.RedisURL != "" {
		if err := checkURL(c.RedisURL, "redis", "rediss"); err != nil {
			errs = append(errs, fmt.Errorf("REDIS_URL: %w", err))
		}
	}
	if c.SchemaRegistryURL != "" {
		if err := checkURL(c.SchemaRegistryURL, "http", "https"); err != nil {
			errs = append(errs, fmt.Errorf("SCHEMA_REGISTRY_URL: %w", err))
		}
		if len(c.KafkaBrokers) == 0 {
			errs = append(errs, errors.New("SCHEMA_REGISTRY_URL is set but KAFKA_BROKERS is empty"))
		}
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
	if raw := str("MIGRATE_ON_START", ""); raw != "" {
		b, err := strconv.ParseBool(raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("MIGRATE_ON_START=%q is not a boolean", raw))
		}
		c.MigrateOnStart = b
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
