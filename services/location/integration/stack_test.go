//go:build integration

// Integration tests against the SHARED Compose stack (deploy/compose). They never start
// infrastructure. Run them in Docker on the stack's network (see README):
//
//	docker run --rm --network kade -v "$PWD:/repo" -w /repo/services/<name> golang:1.25 \
//	  go test -tags integration -count=1 ./integration/...
//
// Address resolution, first match wins:
//  1. IT_DATABASE_URL, IT_KAFKA_BROKERS, IT_SCHEMA_REGISTRY_URL, IT_REDIS_URL, IT_CONNECT_URL
//  2. inside a container on the kade network: postgres:5432, kafka:9092, schema-registry:8081, redis:6379
//  3. inside a container without it: host.docker.internal + host ports (Kafka will NOT work: the
//     broker advertises localhost:19092 to external clients; use --network kade)
//  4. on the host: localhost + host ports (POSTGRES_HOST_PORT etc. honoured, as in deploy/compose/.env)
package integration

import (
	"fmt"
	"net"
	"os"
)

type stack struct {
	DatabaseURL, SchemaRegistryURL, RedisURL string
	ConnectURL                               string // Kafka Connect (Debezium), for the outbox end-to-end test
	Brokers                                  []string
	Where                                    string
}

func resolveStack() stack {
	env := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	dbPath := "location:location@%s/location"
	s := stack{}
	inContainer := fileExists("/.dockerenv")
	switch {
	case inContainer && resolves("kafka") && resolves("postgres"):
		s = stack{Where: "kade network", DatabaseURL: "postgres://" + fmt.Sprintf(dbPath, "postgres:5432"),
			Brokers: []string{"kafka:9092"}, SchemaRegistryURL: "http://schema-registry:8081", RedisURL: "redis://redis:6379",
			ConnectURL: "http://connect:8083"}
	default:
		host := "localhost"
		s.Where = "host ports"
		if inContainer {
			host = "host.docker.internal"
			s.Where = "host.docker.internal (Kafka needs --network kade)"
		}
		s.DatabaseURL = "postgres://" + fmt.Sprintf(dbPath, host+":"+env("POSTGRES_HOST_PORT", "5432"))
		s.Brokers = []string{host + ":" + env("KAFKA_HOST_PORT", "19092")}
		s.SchemaRegistryURL = "http://" + host + ":" + env("SCHEMA_REGISTRY_HOST_PORT", "8085")
		s.RedisURL = "redis://" + host + ":" + env("REDIS_HOST_PORT", "6379")
		s.ConnectURL = "http://" + host + ":" + env("CONNECT_HOST_PORT", "8083")
	}
	s.DatabaseURL = env("IT_DATABASE_URL", s.DatabaseURL)
	if b := os.Getenv("IT_KAFKA_BROKERS"); b != "" {
		s.Brokers = []string{b}
	}
	s.SchemaRegistryURL = env("IT_SCHEMA_REGISTRY_URL", s.SchemaRegistryURL)
	s.RedisURL = env("IT_REDIS_URL", s.RedisURL)
	s.ConnectURL = env("IT_CONNECT_URL", s.ConnectURL)
	return s
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func resolves(host string) bool { _, err := net.LookupHost(host); return err == nil }
