//go:build integration

// Integration tests against the SHARED Compose stack (deploy/compose). They never start
// infrastructure. Run them in Docker on the stack's network (see README):
//
//	docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/<name> golang:1.25 \
//	  go test -tags integration -count=1 ./integration/...
//
// Address resolution, first match wins:
//  1. IT_KAFKA_BROKERS, IT_REDIS_URL
//  2. inside a container on the kade network: kafka:9092, redis:6379
//  3. inside a container without it: host.docker.internal + host ports (Kafka will NOT work: the
//     broker advertises localhost:19092 to external clients; use --network kade)
//  4. on the host: localhost + host ports (POSTGRES_HOST_PORT etc. honoured, as in deploy/compose/.env)
package integration

import (
	"net"
	"os"
)

type stack struct {
	RedisURL string
	Brokers  []string
	Where    string
}

func resolveStack() stack {
	env := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	s := stack{}
	inContainer := fileExists("/.dockerenv")
	switch {
	case inContainer && resolves("kafka") && resolves("redis"):
		s = stack{Where: "kade network", Brokers: []string{"kafka:9092"}, RedisURL: "redis://redis:6379"}
	default:
		host := "localhost"
		s.Where = "host ports"
		if inContainer {
			host = "host.docker.internal"
			s.Where = "host.docker.internal (Kafka needs --network kade)"
		}
		s.Brokers = []string{host + ":" + env("KAFKA_HOST_PORT", "19092")}
		s.RedisURL = "redis://" + host + ":" + env("REDIS_HOST_PORT", "6379")
	}
	if b := os.Getenv("IT_KAFKA_BROKERS"); b != "" {
		s.Brokers = []string{b}
	}
	s.RedisURL = env("IT_REDIS_URL", s.RedisURL)
	return s
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func resolves(host string) bool { _, err := net.LookupHost(host); return err == nil }
