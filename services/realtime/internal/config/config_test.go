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
		"SERVICE_NAME":                "realtime",
		"GRPC_PORT":                   "50112",
		"HTTP_PORT":                   "8112",
		"DATABASE_URL":                "postgres://realtime:realtime@postgres:5432/realtime",
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
	if c.GRPCPort != 50112 || c.HTTPPort != 8112 {
		t.Errorf("ports = %d/%d", c.GRPCPort, c.HTTPPort)
	}
	if got := strings.Join(c.KafkaBrokers, "|"); got != "kafka:9092|other:9092" {
		t.Errorf("brokers = %q", got)
	}
	if c.NoteEventsTopic != "kade.note.events" || c.RPCTimeout != 5*time.Second || !c.MigrateOnStart || c.LogLevel != slog.LevelInfo {
		t.Errorf("defaults not applied: %+v", c)
	}
}

func TestLoadOptionalDependencies(t *testing.T) {
	m := valid()
	delete(m, "KAFKA_BROKERS")
	delete(m, "SCHEMA_REGISTRY_URL")
	delete(m, "REDIS_URL")
	delete(m, "OTEL_EXPORTER_OTLP_ENDPOINT")
	if _, err := Load(env(m)); err != nil {
		t.Fatalf("Kafka, Redis and OTLP should be optional: %v", err)
	}
}

func TestLoadInvalid(t *testing.T) {
	cases := map[string]struct {
		mut  func(map[string]string)
		want string
	}{
		"missing name":       {func(m map[string]string) { delete(m, "SERVICE_NAME") }, "SERVICE_NAME is required"},
		"bad port":           {func(m map[string]string) { m["GRPC_PORT"] = "70000" }, "GRPC_PORT"},
		"same ports":         {func(m map[string]string) { m["HTTP_PORT"] = "50112" }, "must differ"},
		"missing db":         {func(m map[string]string) { delete(m, "DATABASE_URL") }, "DATABASE_URL is required"},
		"db scheme":          {func(m map[string]string) { m["DATABASE_URL"] = "mysql://u:secret@h/db" }, "DATABASE_URL"},
		"registry no kafka":  {func(m map[string]string) { delete(m, "KAFKA_BROKERS") }, "KAFKA_BROKERS is empty"},
		"otlp grpc endpoint": {func(m map[string]string) { m["OTEL_EXPORTER_OTLP_ENDPOINT"] = "otel:4317" }, "OTEL_EXPORTER_OTLP_ENDPOINT"},
		"log level":          {func(m map[string]string) { m["LOG_LEVEL"] = "loud" }, "LOG_LEVEL"},
		"timeout":            {func(m map[string]string) { m["RPC_DEFAULT_TIMEOUT"] = "-1s" }, "RPC_DEFAULT_TIMEOUT"},
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
