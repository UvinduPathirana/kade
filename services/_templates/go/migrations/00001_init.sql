-- +goose Up

-- Business table (the template's example aggregate). Replace with your own.
CREATE TABLE notes (
  id            uuid PRIMARY KEY,                -- UUIDv7
  text          text NOT NULL,
  amount_minor  bigint NOT NULL DEFAULT 0,       -- LKR cents, never floats
  currency      text NOT NULL DEFAULT 'LKR',
  author_id     text,                            -- x-user-id of the creator
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz                      -- set by the NoteCreated consumer (projection demo)
);

-- Transactional outbox, exact shape from docs/backend/CONVENTIONS.md. Debezium's outbox router
-- reads it from the WAL and publishes to kade.<aggregatetype>.events.
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,          -- event id, also used for consumer deduplication
  aggregatetype text NOT NULL,             -- e.g. 'order' → topic kade.order.events
  aggregateid   text NOT NULL,             -- Kafka key
  type          text NOT NULL,             -- fully-qualified proto message, e.g. 'kade.order.v1.OrderPlaced'
  payload       bytea NOT NULL,            -- protobuf-encoded event message
  traceparent   text,                      -- W3C trace context, copied into a Kafka header
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotent consumer: one row per handled event id, written in the same tx as the side effects.
CREATE TABLE processed_events (
  event_id   uuid PRIMARY KEY,
  handled_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency keys for retryable mutating RPCs. scope = RPC name; request_hash detects a key
-- reused with a different request; response = the serialized first response, replayed on retry.
CREATE TABLE idempotency_keys (
  scope        text NOT NULL,
  key          text NOT NULL,
  request_hash bytea NOT NULL,
  response     bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- +goose Down
DROP TABLE idempotency_keys;
DROP TABLE processed_events;
DROP TABLE outbox;
DROP TABLE notes;
