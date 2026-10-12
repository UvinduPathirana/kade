-- Payment's own tables. Money is bigint minor units + currency; never numeric/float.
-- Enum-like columns hold the proto enum names without their prefix ('AUTHORISED', 'CARD', 'VISA', ...).

-- Saved cards: PSP tokens only. No card number, CVC or full track data ever reaches Kadé.
CREATE TABLE saved_cards (
  id            uuid        PRIMARY KEY,                        -- UUIDv7 (seeded: …-8e01-…)
  customer_id   text        NOT NULL,                           -- Keycloak sub
  brand         text        NOT NULL CHECK (brand IN ('VISA', 'MASTERCARD', 'AMEX')),
  last4         text        NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  expiry_month  int         NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year   int         NOT NULL CHECK (expiry_year BETWEEN 2000 AND 2100),
  holder_name   text        NOT NULL DEFAULT '',
  psp_token     text        NOT NULL UNIQUE,                    -- what we charge; opaque to Kadé
  fingerprint   text        NOT NULL,                           -- PSP fingerprint: same card → same value
  added_at      timestamptz NOT NULL DEFAULT now(),
  removed_at    timestamptz                                     -- soft delete: payments keep pointing at the card
);
CREATE INDEX saved_cards_customer ON saved_cards (customer_id, added_at) WHERE removed_at IS NULL;
-- One live copy of a card per customer (AddSavedCard → ALREADY_EXISTS / CARD_ALREADY_SAVED).
CREATE UNIQUE INDEX saved_cards_live_fingerprint ON saved_cards (customer_id, fingerprint) WHERE removed_at IS NULL;

-- Card-capture sessions (CreateCardSetupSession → the app posts the card to the PSP → AddSavedCard).
CREATE TABLE card_setup_sessions (
  id            uuid        PRIMARY KEY,
  customer_id   text        NOT NULL,
  client_secret text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);

CREATE TABLE payments (
  id                     uuid        PRIMARY KEY,               -- UUIDv7 (seeded: …-8e02-<order number>)
  purpose                text        NOT NULL CHECK (purpose IN ('ORDER', 'PLUS_SUBSCRIPTION', 'GIFT_CARD')),
  reference_id           text        NOT NULL,                  -- order id for orders
  reference_label        text        NOT NULL DEFAULT '',       -- 'KD-4821'
  customer_id            text        NOT NULL,
  method_kind            text        NOT NULL CHECK (method_kind IN ('CARD', 'CASH')),
  card_id                uuid        REFERENCES saved_cards (id),
  card_brand             text        NOT NULL DEFAULT '',
  card_last4             text        NOT NULL DEFAULT '',
  cash_paying_with_minor bigint,
  currency               text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                 text        NOT NULL CHECK (status IN ('PENDING', 'AUTHORISED', 'DECLINED', 'CASH_DUE',
                                       'CAPTURED', 'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED')),
  amount_requested_minor bigint      NOT NULL CHECK (amount_requested_minor > 0),
  amount_authorised_minor bigint     NOT NULL DEFAULT 0 CHECK (amount_authorised_minor >= 0),
  amount_captured_minor  bigint      NOT NULL DEFAULT 0 CHECK (amount_captured_minor >= 0),
  amount_refunded_minor  bigint      NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  psp_reference          text        NOT NULL DEFAULT '',
  decline_code           text        NOT NULL DEFAULT '',
  decline_message        text        NOT NULL DEFAULT '',
  collected_by_rider_id  text        NOT NULL DEFAULT '',
  delivery_id            text        NOT NULL DEFAULT '',
  -- AuthorisePayment idempotency: a retry with the same key returns the payment's CURRENT state (so a
  -- PENDING authorisation resolved later by webhook is visible to the retry), unlike the stored-response
  -- idempotency_keys table used by the other mutations.
  authorise_principal    text        NOT NULL DEFAULT '',
  authorise_key          text        NOT NULL,
  authorise_request_hash bytea       NOT NULL,
  version                bigint      NOT NULL DEFAULT 0,        -- optimistic locking: UPDATE ... WHERE version = ?
  created_at             timestamptz NOT NULL DEFAULT now(),
  authorised_at          timestamptz,
  captured_at            timestamptz,
  voided_at              timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_captured_minor <= amount_authorised_minor),
  CHECK (amount_refunded_minor <= amount_captured_minor),
  CHECK (method_kind = 'CASH' OR card_id IS NOT NULL),
  UNIQUE (authorise_principal, authorise_key)
);
CREATE INDEX payments_reference ON payments (reference_id, created_at DESC);
CREATE INDEX payments_customer ON payments (customer_id, created_at DESC);

CREATE TABLE payment_refunds (
  id              uuid        PRIMARY KEY,
  payment_id      uuid        NOT NULL REFERENCES payments (id),
  amount_minor    bigint      NOT NULL CHECK (amount_minor > 0),
  currency        text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason          text        NOT NULL DEFAULT '',
  order_refund_id text        NOT NULL DEFAULT '',
  status          text        NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  psp_reference   text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX payment_refunds_payment ON payment_refunds (payment_id, created_at);

-- PSP webhooks: deduplicated on the PSP's event id.
CREATE TABLE psp_webhook_events (
  provider     text        NOT NULL,
  event_id     text        NOT NULL,
  event_type   text        NOT NULL,
  payment_id   uuid,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
