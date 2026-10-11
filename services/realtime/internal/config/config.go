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

// DefaultTopics are the streams realtime turns into pushes (proto/README.md, "Realtime").
var DefaultTopics = []string{
	"kade.order.events",
	"kade.merchant.events",
	"kade.delivery.events",
	"kade.rider.events",
	"kade.restaurant.events",
	"kade.menu.events",
	"kade.ticket.events",
	"kade.ledger.events",
	"kade.rider.locations",
}

type Config struct {
	ServiceName string // SERVICE_NAME: also the OTel service name
	Version     string // SERVICE_VERSION (optional, defaults to "dev")
	HTTPPort    int    // HTTP_PORT: /ws, /health/*, /metrics (realtime has no gRPC API)

	KafkaBrokers []string // KAFKA_BROKERS (required)
	KafkaGroup   string   // KAFKA_GROUP (default SERVICE_NAME): ONE group shared by every replica
	Topics       []string // CONSUME_TOPICS (default DefaultTopics)
	// LOCATIONS_TOPIC (default kade.rider.locations): the topic decoded as Schema Registry framed
	// RiderLocation records instead of outbox events.
	LocationsTopic string
	RedisURL       string // REDIS_URL (required): pub/sub fan-out + views + dedup
	RedisPrefix    string // REDIS_PREFIX (default "rt:"): pub/sub channels are <prefix><channel>
	OTLPEndpoint   string // OTEL_EXPORTER_OTLP_ENDPOINT: empty keeps telemetry local
	OrderGRPC      string // ORDER_GRPC (optional): order:<id> ownership fallback before OrderPlaced is seen

	LogLevel slog.Level // LOG_LEVEL: debug|info|warn|error

	// AUTH_DEV_BYPASS=true AND DEPLOY_ENV=dev: identity may come from query parameters
	// (?user=&roles=&outlet=&rider=) and anonymous sockets may watch public channels.
	DevBypass      bool
	OriginPatterns []string // WS_ORIGIN_PATTERNS: if set, only these Origin hosts may connect (default: no Origin check)

	SendBuffer       int           // WS_SEND_BUFFER (default 256 frames): full = slow client closed
	PingInterval     time.Duration // WS_PING_INTERVAL (default 25s)
	WriteTimeout     time.Duration // WS_WRITE_TIMEOUT (default 5s)
	MaxSubscriptions int           // WS_MAX_SUBSCRIPTIONS (default 32 channels per socket)

	PositionInterval time.Duration // POSITION_MIN_INTERVAL (default 1s): per order / per rider throttle
	OpsInterval      time.Duration // OPS_PUSH_INTERVAL (default 1s): ops:live counter frames are coalesced
	ViewTTL          time.Duration // VIEW_TTL (default 48h): order/ticket/delivery projections in Redis
	StaleAfter       time.Duration // PUSH_STALE_AFTER (default 10m): older events update views but aren't pushed
	ReplayWindow     time.Duration // REPLAY_WINDOW (default 2m): Subscribe.since buffer per channel
	ShutdownTimeout  time.Duration // SHUTDOWN_TIMEOUT (default 20s)
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
	num := func(key string, def int) int {
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
	boolean := func(key string) bool {
		raw := str(key, "")
		if raw == "" {
			return false
		}
		b, err := strconv.ParseBool(raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s=%q is not a boolean", key, raw))
		}
		return b
	}

	c := Config{
		ServiceName:      str("SERVICE_NAME", ""),
		Version:          str("SERVICE_VERSION", "dev"),
		HTTPPort:         port("HTTP_PORT"),
		KafkaBrokers:     splitList(getenv("KAFKA_BROKERS")),
		Topics:           splitList(getenv("CONSUME_TOPICS")),
		LocationsTopic:   str("LOCATIONS_TOPIC", "kade.rider.locations"),
		RedisURL:         str("REDIS_URL", ""),
		RedisPrefix:      str("REDIS_PREFIX", "rt:"),
		OTLPEndpoint:     str("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		OrderGRPC:        str("ORDER_GRPC", ""),
		OriginPatterns:   splitList(getenv("WS_ORIGIN_PATTERNS")),
		SendBuffer:       num("WS_SEND_BUFFER", 256),
		PingInterval:     dur("WS_PING_INTERVAL", 25*time.Second),
		WriteTimeout:     dur("WS_WRITE_TIMEOUT", 5*time.Second),
		MaxSubscriptions: num("WS_MAX_SUBSCRIPTIONS", 32),
		PositionInterval: dur("POSITION_MIN_INTERVAL", time.Second),
		OpsInterval:      dur("OPS_PUSH_INTERVAL", time.Second),
		ViewTTL:          dur("VIEW_TTL", 48*time.Hour),
		StaleAfter:       dur("PUSH_STALE_AFTER", 10*time.Minute),
		ReplayWindow:     dur("REPLAY_WINDOW", 2*time.Minute),
		ShutdownTimeout:  dur("SHUTDOWN_TIMEOUT", 20*time.Second),
	}
	c.KafkaGroup = str("KAFKA_GROUP", c.ServiceName)
	if len(c.Topics) == 0 {
		c.Topics = append([]string(nil), DefaultTopics...)
	}
	devBypass := boolean("AUTH_DEV_BYPASS")
	if devBypass && str("DEPLOY_ENV", "") != "dev" {
		errs = append(errs, errors.New("AUTH_DEV_BYPASS=true requires DEPLOY_ENV=dev"))
	}
	c.DevBypass = devBypass && str("DEPLOY_ENV", "") == "dev"

	if c.ServiceName == "" {
		errs = append(errs, errors.New("SERVICE_NAME is required"))
	}
	if len(c.KafkaBrokers) == 0 {
		errs = append(errs, errors.New("KAFKA_BROKERS is required"))
	}
	if c.RedisURL == "" {
		errs = append(errs, errors.New("REDIS_URL is required"))
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
