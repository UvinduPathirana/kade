-- +goose Up

-- The rider fleet. `data` is the kade.dispatch.v1.Rider snapshot (profile, vehicle, documents,
-- bank last4, rating…); the columns mirror what queries filter on and are written with it.
CREATE TABLE riders (
  id               uuid PRIMARY KEY,
  user_id          text UNIQUE,                    -- Keycloak sub; NULL for riders without a login
  name             text NOT NULL,
  phone            text NOT NULL,
  status           smallint NOT NULL,              -- kade.dispatch.v1.RiderStatus
  zone_ids         text[] NOT NULL DEFAULT '{}',
  cash_held_minor  bigint NOT NULL DEFAULT 0,      -- from ledger RiderCashBalanceChanged
  cash_limit_minor bigint NOT NULL DEFAULT 1500000,
  cash_allowed     boolean NOT NULL DEFAULT true,
  simulated        boolean NOT NULL DEFAULT false, -- demo fleet driven by the simulator
  last_lat         double precision,
  last_lng         double precision,
  last_seen_at     timestamptz,
  data             bytea NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX riders_status ON riders (status);

-- Onboarding. `data` is the kade.dispatch.v1.RiderApplication (bank account number blanked);
-- the full account number is kept apart and never returned.
CREATE TABLE rider_applications (
  id                  uuid PRIMARY KEY,
  phone               text NOT NULL,               -- digits only, for GetRiderApplicationStatus
  user_id             text,                        -- caller at submission; becomes the rider's user_id
  status              smallint NOT NULL,           -- kade.common.v1.ApplicationStatus
  submitted_at        timestamptz NOT NULL,
  bank_account_number text,
  data                bytea NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_applications_phone ON rider_applications (phone, submitted_at DESC);
CREATE INDEX rider_applications_status ON rider_applications (status, submitted_at);

-- One delivery per order. `data` is the kade.dispatch.v1.Delivery; the columns mirror it plus the
-- internal fields the proto doesn't carry (delivery code, matching schedule, food-ready time).
CREATE TABLE deliveries (
  id                    uuid PRIMARY KEY,
  order_id              text NOT NULL UNIQUE,
  order_number          text NOT NULL DEFAULT '',
  customer_id           text NOT NULL DEFAULT '',
  restaurant_id         text NOT NULL DEFAULT '',
  zone_id               text NOT NULL DEFAULT '',
  status                smallint NOT NULL,         -- kade.dispatch.v1.DeliveryStatus
  rider_id              uuid,
  payment               smallint NOT NULL DEFAULT 0,
  cash_to_collect_minor bigint NOT NULL DEFAULT 0,
  delivery_code         text NOT NULL DEFAULT '',
  due_at                timestamptz,
  food_ready_at         timestamptz,               -- OrderReady
  attempts              int NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,               -- matching schedule; NULL while an offer is open
  matching_failed_at    timestamptz,               -- DeliveryMatchingFailed published
  from_lat              double precision,          -- rider position when the job was accepted
  from_lng              double precision,
  requested_at          timestamptz NOT NULL,
  assigned_at           timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  customer_rating       smallint NOT NULL DEFAULT 0,
  pay_total_minor       bigint NOT NULL DEFAULT 0,
  data                  bytea NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_matching ON deliveries (next_attempt_at) WHERE status IN (1, 8);
CREATE INDEX deliveries_rider ON deliveries (rider_id, delivered_at DESC);
CREATE INDEX deliveries_requested ON deliveries (requested_at);
CREATE INDEX deliveries_open ON deliveries (status) WHERE status NOT IN (6, 7);

-- Offers: one rider at a time per delivery, one open offer at a time per rider.
CREATE TABLE offers (
  id             uuid PRIMARY KEY,
  delivery_id    uuid NOT NULL REFERENCES deliveries (id),
  rider_id       uuid NOT NULL,
  status         smallint NOT NULL,                -- kade.dispatch.v1.OfferStatus
  offered_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  decided_at     timestamptz,
  decline_reason text NOT NULL DEFAULT '',
  data           bytea NOT NULL                    -- kade.dispatch.v1.DeliveryOffer as offered
);
CREATE UNIQUE INDEX offers_one_open_per_delivery ON offers (delivery_id) WHERE status = 1;
CREATE UNIQUE INDEX offers_one_open_per_rider ON offers (rider_id) WHERE status = 1;
CREATE INDEX offers_expiry ON offers (expires_at) WHERE status = 1;
CREATE INDEX offers_rider ON offers (rider_id, offered_at DESC);
CREATE INDEX offers_delivery ON offers (delivery_id, offered_at);

-- Quick replies the rider sent the customer through masked messaging.
CREATE TABLE customer_messages (
  id          uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES deliveries (id),
  rider_id    uuid NOT NULL,
  text        text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox, exact shape from docs/backend/CONVENTIONS.md. aggregatetype 'delivery'
-- → kade.delivery.events, 'rider' → kade.rider.events.
CREATE TABLE outbox (
  id            uuid PRIMARY KEY,
  aggregatetype text NOT NULL,
  aggregateid   text NOT NULL,
  type          text NOT NULL,
  payload       bytea NOT NULL,
  traceparent   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processed_events (
  event_id   uuid PRIMARY KEY,
  handled_at timestamptz NOT NULL DEFAULT now()
);

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
DROP TABLE customer_messages;
DROP TABLE offers;
DROP TABLE deliveries;
DROP TABLE rider_applications;
DROP TABLE riders;
