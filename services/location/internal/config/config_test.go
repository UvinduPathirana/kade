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
		"SERVICE_NAME":                "location",
		"GRPC_PORT":                   "50111",
		"HTTP_PORT":                   "8111",
		"KAFKA_BROKERS":               "kafka:9092, other:9092 ,",
		"SCHEMA_REGISTRY_URL":         "http://schema-registry:8081",
		"REDIS_URL":                   "redis://redis:6379",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel:4318",
	}
}

func TestLoadValid(t *testing.T) {
	c, err := Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.GRPCPort != 50111 || c.HTTPPort != 8111 {
		t.Errorf("ports = %d/%d", c.GRPCPort, c.HTTPPort)
	}
	if got := strings.Join(c.KafkaBrokers, "|"); got != "kafka:9092|other:9092" {
		t.Errorf("brokers = %q", got)
	}
	if c.StreamTopic != "kade.rider.locations" || c.LastKnownTTL != 30*time.Minute || c.MaxSpeedMPS != 50 || c.LogLevel != slog.LevelInfo {
		t.Errorf("defaults not applied: %+v", c)
	}
}

func TestLoadInvalid(t *testing.T) {
	cases := map[string]struct {
		mut  func(map[string]string)
		want string
	}{
		"missing name":   {func(m map[string]string) { delete(m, "SERVICE_NAME") }, "SERVICE_NAME is required"},
		"bad port":       {func(m map[string]string) { m["GRPC_PORT"] = "70000" }, "GRPC_PORT"},
		"same ports":     {func(m map[string]string) { m["HTTP_PORT"] = "50111" }, "must differ"},
		"no kafka":       {func(m map[string]string) { delete(m, "KAFKA_BROKERS") }, "KAFKA_BROKERS is required"},
		"no registry":    {func(m map[string]string) { delete(m, "SCHEMA_REGISTRY_URL") }, "SCHEMA_REGISTRY_URL is required"},
		"no redis":       {func(m map[string]string) { delete(m, "REDIS_URL") }, "REDIS_URL is required"},
		"bad redis":      {func(m map[string]string) { m["REDIS_URL"] = "http://redis" }, "REDIS_URL"},
		"bad speed":      {func(m map[string]string) { m["MAX_SPEED_MPS"] = "-1" }, "MAX_SPEED_MPS"},
		"bad ttl":        {func(m map[string]string) { m["LAST_KNOWN_TTL"] = "soon" }, "LAST_KNOWN_TTL"},
		"bad log level":  {func(m map[string]string) { m["LOG_LEVEL"] = "loud" }, "LOG_LEVEL"},
		"grpc otlp port": {func(m map[string]string) { m["OTEL_EXPORTER_OTLP_ENDPOINT"] = "otel:4317" }, "OTEL_EXPORTER_OTLP_ENDPOINT"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			m := valid()
			tc.mut(m)
			_, err := Load(env(m))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}
