-- Promotion's own tables. Money is bigint minor units + currency (CONVENTIONS); budgets and use counters
-- carry a version column and are only written with UPDATE ... WHERE version = ? (optimistic locking).

-- Kadé-funded voucher codes (admin console). `status` is the stored lifecycle; the scheduler moves
-- scheduled -> active on starts_on and anything -> ended after ends_on (Asia/Colombo dates, inclusive).
CREATE TABLE vouchers (
  code                text        PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4,16}$'),
  label               text        NOT NULL,
  description         text        NOT NULL DEFAULT '',
  type                text        NOT NULL CHECK (type IN ('fixed', 'percent', 'free_delivery')),
  amount_minor        bigint      NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  percent             int         NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  max_discount_minor  bigint      NOT NULL DEFAULT 0 CHECK (max_discount_minor >= 0),
  min_order_minor     bigint      NOT NULL DEFAULT 0 CHECK (min_order_minor >= 0),
  currency            text        NOT NULL DEFAULT 'LKR' CHECK (currency ~ '^[A-Z]{3}$'),
  restaurant_ids      text[]      NOT NULL DEFAULT '{}',
  new_customers_only  boolean     NOT NULL DEFAULT false,
  starts_on           date        NOT NULL,
  ends_on             date        NOT NULL,
  uses                int         NOT NULL DEFAULT 0 CHECK (uses >= 0),        -- redeemed
  held_uses           int         NOT NULL DEFAULT 0 CHECK (held_uses >= 0),   -- open reservations
  use_limit           int         NOT NULL DEFAULT 0 CHECK (use_limit >= 0),   -- 0 = unlimited
  per_customer_limit  int         NOT NULL DEFAULT 0 CHECK (per_customer_limit >= 0),
  budget_minor        bigint      NOT NULL DEFAULT 0 CHECK (budget_minor >= 0), -- 0 = no budget cap
  spent_minor         bigint      NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
  reserved_minor      bigint      NOT NULL DEFAULT 0 CHECK (reserved_minor >= 0),
  status              text        NOT NULL CHECK (status IN ('active', 'scheduled', 'paused', 'ended')),
  status_reason       text        NOT NULL DEFAULT '',
  funded_by           text        NOT NULL DEFAULT 'kade' CHECK (funded_by IN ('kade', 'restaurant')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  version             bigint      NOT NULL DEFAULT 0,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX vouchers_status ON vouchers (status);

-- A discount held against a voucher's budget and use limit for one order (saga step 2).
CREATE TABLE promo_reservations (
  id             uuid        PRIMARY KEY,
  code           text        NOT NULL REFERENCES vouchers (code),
  customer_id    text        NOT NULL,
  order_id       text        NOT NULL,
  discount_minor bigint      NOT NULL CHECK (discount_minor >= 0),
  currency       text        NOT NULL,
  funded_by      text        NOT NULL,
  status         text        NOT NULL CHECK (status IN ('held', 'redeemed', 'released', 'expired')),
  reason         text        NOT NULL DEFAULT '',
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promo_reservations_order ON promo_reservations (order_id);
CREATE INDEX promo_reservations_customer_code ON promo_reservations (customer_id, code);
CREATE INDEX promo_reservations_held_expiry ON promo_reservations (expires_at) WHERE status = 'held';

-- Customers with at least one finished order (from kade.order.events), for new-customer codes and referrals.
CREATE TABLE customer_orders (
  customer_id text        NOT NULL,
  order_id    text        NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, order_id)
);

-- Restaurant-funded automatic offers (restaurant app). state: scheduled -> active -> ended.
CREATE TABLE offers (
  id                 uuid        PRIMARY KEY,
  restaurant_id      text        NOT NULL,
  type               text        NOT NULL CHECK (type IN ('percent', 'amount', 'bogo', 'free_delivery')),
  label              text        NOT NULL,
  percent            int         NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  amount_minor       bigint      NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  max_discount_minor bigint      NOT NULL DEFAULT 0 CHECK (max_discount_minor >= 0),
  min_order_minor    bigint      NOT NULL DEFAULT 0 CHECK (min_order_minor >= 0),
  currency           text        NOT NULL DEFAULT 'LKR' CHECK (currency ~ '^[A-Z]{3}$'),
  buy                int         NOT NULL DEFAULT 0 CHECK (buy >= 0),
  get                int         NOT NULL DEFAULT 0 CHECK (get >= 0),
  bogo_item_id       text        NOT NULL DEFAULT '',
  section_ids        text[]      NOT NULL DEFAULT '{}',
  start_date         date        NOT NULL,
  end_date           date        NOT NULL,
  budget_minor       bigint      NOT NULL DEFAULT 0 CHECK (budget_minor >= 0),  -- 0 = no budget cap
  spent_minor        bigint      NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
  orders             int         NOT NULL DEFAULT 0 CHECK (orders >= 0),
  state              text        NOT NULL CHECK (state IN ('scheduled', 'active', 'ended')),
  end_reason         text        NOT NULL DEFAULT '',
  ended_at           timestamptz,
  created_by         text        NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  version            bigint      NOT NULL DEFAULT 0,
  CHECK (end_date >= start_date)
);
CREATE INDEX offers_restaurant ON offers (restaurant_id, state);

-- One row per (offer, order) so a redelivered OrderDelivered can never charge an offer twice.
CREATE TABLE offer_redemptions (
  offer_id       uuid        NOT NULL REFERENCES offers (id),
  order_id       text        NOT NULL,
  discount_minor bigint      NOT NULL,
  redeemed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, order_id)
);

CREATE TABLE gift_cards (
  id                 uuid        PRIMARY KEY,
  buyer_customer_id  text        NOT NULL,
  amount_minor       bigint      NOT NULL CHECK (amount_minor > 0),
  currency           text        NOT NULL DEFAULT 'LKR',
  recipient_name     text        NOT NULL,
  contact            text        NOT NULL,
  message            text        NOT NULL DEFAULT '',
  send_on            date        NOT NULL,
  card_id            text        NOT NULL,
  card_label         text        NOT NULL DEFAULT '',
  payment_id         text        NOT NULL DEFAULT '',
  redemption_code    text        NOT NULL UNIQUE,
  status             text        NOT NULL CHECK (status IN ('scheduled', 'sent', 'redeemed')),
  bought_at          timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  redeemed_at        timestamptz,
  redeemed_by        text
);
CREATE INDEX gift_cards_buyer ON gift_cards (buyer_customer_id, bought_at DESC);
CREATE INDEX gift_cards_due ON gift_cards (send_on) WHERE status = 'scheduled';

-- A customer's invite code ("DILINI500") and the friends who used it.
CREATE TABLE referral_codes (
  customer_id text        PRIMARY KEY,
  code        text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referral_friends (
  id                   uuid        PRIMARY KEY,
  referrer_customer_id text        NOT NULL,
  referred_customer_id text        UNIQUE,         -- null for invitations we only know by name (seed)
  name                 text        NOT NULL,
  status               text        NOT NULL CHECK (status IN ('invited', 'joined', 'ordered')),
  status_at            timestamptz NOT NULL DEFAULT now(),
  reward_order_id      text
);
CREATE INDEX referral_friends_referrer ON referral_friends (referrer_customer_id, status_at DESC);
