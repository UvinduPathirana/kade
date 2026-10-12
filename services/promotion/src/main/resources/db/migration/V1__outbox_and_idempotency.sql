-- Infrastructure tables every Kadé service has. Keep this migration as-is when copying the template.

-- Transactional outbox (CONVENTIONS "Events and the outbox"; DDL must match exactly: Debezium reads it).
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,          -- event id, also used for consumer deduplication
  aggregatetype text NOT NULL,             -- e.g. 'order' → topic kade.order.events
  aggregateid   text NOT NULL,             -- Kafka key
  type          text NOT NULL,             -- fully-qualified proto message, e.g. 'kade.order.v1.OrderPlaced'
  payload       bytea NOT NULL,            -- protobuf-encoded event message
  traceparent   text,                      -- W3C trace context, copied into a Kafka header
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Consumer deduplication: one row per handled event id, inserted in the same transaction as the side effect.
CREATE TABLE processed_events (
  event_id   uuid PRIMARY KEY,
  handled_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent mutating RPCs: the first call with a key stores its response; retries get it back.
-- request_hash detects the same key reused for a different request.
CREATE TABLE idempotency_keys (
  operation       text        NOT NULL,   -- RPC, e.g. 'kade.template.v1.TemplateService/CreateNote'
  principal       text        NOT NULL,   -- x-user-id ('' for service-to-service calls)
  idempotency_key text        NOT NULL,
  request_hash    bytea       NOT NULL,   -- SHA-256 of the request without the key
  response        bytea,                  -- protobuf-encoded response, set in the same transaction
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, principal, idempotency_key)
);
CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);
