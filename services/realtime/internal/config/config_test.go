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
		"HTTP_PORT":                   "8112",
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
	if c.HTTPPort != 8112 {
		t.Errorf("port = %d", c.HTTPPort)
	}
	if got := strings.Join(c.KafkaBrokers, "|"); got != "kafka:9092|other:9092" {
		t.Errorf("brokers = %q", got)
	}
	if c.KafkaGroup != "realtime" || c.RedisPrefix != "rt:" || c.SendBuffer != 256 || c.PositionInterval != time.Second ||
		c.LogLevel != slog.LevelInfo || c.DevBypass || len(c.Topics) != len(DefaultTopics) {
		t.Errorf("defaults not applied: %+v", c)
	}
}

func TestDevBypassNeedsDevEnv(t *testing.T) {
	m := valid()
	m["AUTH_DEV_BYPASS"] = "true"
	if _, err := Load(env(m)); err == nil || !strings.Contains(err.Error(), "DEPLOY_ENV=dev") {
		t.Fatalf("err = %v", err)
	}
	m["DEPLOY_ENV"] = "dev"
	c, err := Load(env(m))
	if err != nil || !c.DevBypass {
		t.Fatalf("dev bypass not enabled: %v %+v", err, c)
	}
}

func TestLoadInvalid(t *testing.T) {
	cases := map[string]struct {
		mut  func(map[string]string)
		want string
	}{
		"missing name":       {func(m map[string]string) { delete(m, "SERVICE_NAME") }, "SERVICE_NAME is required"},
		"bad port":           {func(m map[string]string) { m["HTTP_PORT"] = "70000" }, "HTTP_PORT"},
		"missing kafka":      {func(m map[string]string) { delete(m, "KAFKA_BROKERS") }, "KAFKA_BROKERS is required"},
		"missing redis":      {func(m map[string]string) { delete(m, "REDIS_URL") }, "REDIS_URL is required"},
		"redis scheme":       {func(m map[string]string) { m["REDIS_URL"] = "http://u:secret@h:6379" }, "REDIS_URL"},
		"otlp grpc endpoint": {func(m map[string]string) { m["OTEL_EXPORTER_OTLP_ENDPOINT"] = "otel:4317" }, "OTEL_EXPORTER_OTLP_ENDPOINT"},
		"log level":          {func(m map[string]string) { m["LOG_LEVEL"] = "loud" }, "LOG_LEVEL"},
		"duration":           {func(m map[string]string) { m["POSITION_MIN_INTERVAL"] = "-1s" }, "POSITION_MIN_INTERVAL"},
		"buffer":             {func(m map[string]string) { m["WS_SEND_BUFFER"] = "0" }, "WS_SEND_BUFFER"},
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
