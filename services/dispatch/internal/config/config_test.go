package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func valid() map[string]string {
	return map[string]string{
		"SERVICE_NAME":                "dispatch",
		"GRPC_PORT":                   "50110",
		"HTTP_PORT":                   "8110",
		"DATABASE_URL":                "postgres://dispatch:dispatch@postgres:5432/dispatch",
		"KAFKA_BROKERS":               "kafka:9092, other:9092 ,",
		"REDIS_URL":                   "redis://redis:6379",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel:4318",
	}
}

func TestLoadValid(t *testing.T) {
	c, err := Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.GRPCPort != 50110 || c.HTTPPort != 8110 {
		t.Errorf("ports = %d/%d", c.GRPCPort, c.HTTPPort)
	}
	if got := strings.Join(c.KafkaBrokers, "|"); got != "kafka:9092|other:9092" {
		t.Errorf("brokers = %q", got)
	}
	if c.OfferTimeout != 30*time.Second || len(c.MatchRadiiKm) != 3 || !c.PreferRealRiders || c.SimulateRiders ||
		!c.SeedOnStart || c.LocationsTopic != "kade.rider.locations" || len(c.EventTopics) != 3 || c.LogLevel != slog.LevelInfo {
		t.Errorf("defaults not applied: %+v", c)
	}
}

func TestLoadOverrides(t *testing.T) {
	m := valid()
	m["MATCH_RADII_KM"] = "2, 5"
	m["SIMULATE_RIDERS"] = "true"
	m["LOCATIONS_TOPIC"] = "-"
	m["OFFER_TIMEOUT"] = "10s"
	c, err := Load(env(m))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.MatchRadiiKm) != 2 || c.MatchRadiiKm[1] != 5 || !c.SimulateRiders || c.LocationsTopic != "" || c.OfferTimeout != 10*time.Second {
		t.Errorf("overrides not applied: %+v", c)
	}
}

func TestLoadInvalid(t *testing.T) {
	cases := map[string]struct {
		mut  func(map[string]string)
		want string
	}{
		"missing name":       {func(m map[string]string) { delete(m, "SERVICE_NAME") }, "SERVICE_NAME is required"},
		"bad port":           {func(m map[string]string) { m["GRPC_PORT"] = "70000" }, "GRPC_PORT"},
		"same ports":         {func(m map[string]string) { m["HTTP_PORT"] = "50110" }, "must differ"},
		"missing db":         {func(m map[string]string) { delete(m, "DATABASE_URL") }, "DATABASE_URL is required"},
		"db scheme":          {func(m map[string]string) { m["DATABASE_URL"] = "mysql://u:secret@h/db" }, "DATABASE_URL"},
		"missing redis":      {func(m map[string]string) { delete(m, "REDIS_URL") }, "REDIS_URL is required"},
		"otlp grpc endpoint": {func(m map[string]string) { m["OTEL_EXPORTER_OTLP_ENDPOINT"] = "otel:4317" }, "OTEL_EXPORTER_OTLP_ENDPOINT"},
		"log level":          {func(m map[string]string) { m["LOG_LEVEL"] = "loud" }, "LOG_LEVEL"},
		"timeout":            {func(m map[string]string) { m["RPC_DEFAULT_TIMEOUT"] = "-1s" }, "RPC_DEFAULT_TIMEOUT"},
		"radii":              {func(m map[string]string) { m["MATCH_RADII_KM"] = "3,far" }, "MATCH_RADII_KM"},
		"bool":               {func(m map[string]string) { m["SIMULATE_RIDERS"] = "maybe" }, "SIMULATE_RIDERS"},
		"fail after":         {func(m map[string]string) { m["MATCH_FAIL_AFTER"] = "0" }, "MATCH_FAIL_AFTER"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			m := valid()
			tc.mut(m)
			_, err := Load(env(m))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatalf("error leaks a password: %v", err)
			}
		})
	}
}
