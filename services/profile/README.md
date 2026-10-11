# profile (`@kade/profile`)

Kadé's customer service, plus the identity RPCs Keycloak doesn't give the gateways. TypeScript
(NestJS + Drizzle), built from the [TS template](../_templates/ts/README.md).

|           |                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| gRPC      | **50103**: `kade.profile.v1` (CustomerService, AddressService, FavouriteService, CreditService, PlusService) and `kade.identity.v1` (PhoneSignInService, StaffService, AuditService) |
| HTTP      | **8103**: `/health/live`, `/health/ready` (Postgres + Kafka), `/metrics`                                                                                                             |
| Database  | `profile` (login `profile`/`profile`); migrations in `drizzle/` run on start                                                                                                         |
| Publishes | `kade.customer.events` (aggregate `customer`, key = customer id) via the outbox                                                                                                      |
| Consumes  | `kade.order.events`, `kade.payment.events` (group `profile`): customer stats and fraud flags                                                                                         |
| Compose   | `services/profile/compose.yaml`, profile `ordering`, 192 MB                                                                                                                          |

## What it owns

Customers (name, phone, email, area, block state), saved addresses and the "deliver here" waitlist,
favourite restaurants, notification/diet/language preferences, the **Kadé credit wallet** (system of
record; ledger mirrors it from `CustomerCreditChanged`), **Kadé Plus** membership, fraud flags and
per-customer order stats. Identity side: phone OTP challenges, the staff team and role permission
matrix, and the audit log.

## Identity: how customer ids work

**A customer's id is their Keycloak subject (`sub`)**, i.e. the `x-user-id` the gateways already
send. There is no separate customer id. Any Keycloak user works as a customer.

What a gateway does:

1. Validate the JWT, then call **`CustomerService.EnsureCustomer`** once per session (or on every
   `/me` load; it's idempotent): `customer_id = sub`, `name`, `email` (and `phone` if known) from the
   token, with metadata `x-user-id: <sub>`, `x-roles: <realm roles>`.
   - It creates the customer the first time (emits `CustomerRegistered`, creates default
     preferences). Later calls only **fill fields that are still empty**, so a customer's own edits
     are never overwritten by token claims.
   - `is_new` is true when the customer was just created or still has no name: the app shows the
     "what's your name" step, then calls `UpdateProfile`.
   - Phone-only Keycloak accounts carry a placeholder `<digits>@phone.kade.test` email and the name
     "Kade Customer"; profile ignores both.
2. Every "me" RPC takes `customer_id` explicitly: the gateway fills it with `sub`. Write RPCs
   (addresses, favourites, preferences, Plus) also create a bare customer if EnsureCustomer was
   skipped; `GetCustomer` on an unknown id returns `NOT_FOUND CUSTOMER_NOT_FOUND`.

Authorisation (from gRPC metadata):

| Caller                                                      | Allowed                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `x-user-id` with no staff role (customers)                  | only `customer_id == x-user-id`, else `PERMISSION_DENIED NOT_YOUR_ACCOUNT`. `ChangeCredit` only with `ORDER_SPEND` / `ORDER_SPEND_REVERSED` |
| staff (`ops`, `support`, `finance`, `admin`)                | any customer. Block/unblock and resolving flags need `ops`, `support` or `admin`. Team writes need `admin`                                  |
| no `x-user-id` (internal service call, e.g. the order saga) | trusted (CONVENTIONS "Auth")                                                                                                                |

Demo Keycloak users have fixed subs (CONVENTIONS "Seeded ids"), so the seed writes straight to them.

## API

All errors are gRPC status + `google.rpc.ErrorInfo` (`domain: profile`) with the reason below.

### kade.profile.v1

| RPC                                         | Notes / reasons                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomerService.GetCustomer`               | `CUSTOMER_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                                     |
| `CustomerService.EnsureCustomer`            | see above. `PHONE_INVALID` (not a 07x mobile; normalised to E.164)                                                                                                                                                                                                                                                                                                                       |
| `CustomerService.UpdateProfile`             | `NAME_REQUIRED`, `NAME_TOO_LONG`, `EMAIL_INVALID`. Emits `CustomerProfileUpdated`                                                                                                                                                                                                                                                                                                        |
| `CustomerService.Get/UpdatePreferences`     | defaults: push + SMS order updates on, marketing off, `en`. `LANGUAGE_UNSUPPORTED` (`en`/`si`/`ta`)                                                                                                                                                                                                                                                                                      |
| `CustomerService.ListCustomers`             | staff. Search by name, email, phone digits (`077 123` matches `+9477123…`) or exact id; `flagged_only`, `blocked_only`; newest first; page size 25 (max 100)                                                                                                                                                                                                                             |
| `CustomerService.GetCustomerDetail`         | stats, credit (balance + last 50 entries), flags, addresses, Plus                                                                                                                                                                                                                                                                                                                        |
| `CustomerService.SetCustomerBlocked`        | `BLOCK_REASON_REQUIRED`. Blocking marks open flags ACTIONED ("Blocked by <staff>"). Emits `CustomerBlockChanged`                                                                                                                                                                                                                                                                         |
| `CustomerService.ResolveFraudFlag`          | status CLEARED/ACTIONED (`FLAG_STATUS_INVALID`), `FLAG_NOT_FOUND`, `FLAG_ALREADY_RESOLVED`                                                                                                                                                                                                                                                                                               |
| `AddressService.ListAddresses`              | oldest first                                                                                                                                                                                                                                                                                                                                                                             |
| `AddressService.SaveAddress`                | empty id = create (UUIDv7); an id (`[A-Za-z0-9_-]{1,64}`, e.g. `home`) = upsert. Resolves `zone_id` through `pricing.ResolveZone` when `PRICING_GRPC` is set and reachable, else keeps the given `zone_id`. Max 20 (`ADDRESS_LIMIT`). `ADDRESS_LABEL_REQUIRED`, `ADDRESS_LINE_REQUIRED`, `ADDRESS_ID_INVALID`, `LOCATION_INVALID`. Customer `area` follows the Home (else first) address |
| `AddressService.RemoveAddress`              | idempotent                                                                                                                                                                                                                                                                                                                                                                               |
| `AddressService.JoinWaitlist`               | idempotent per (customer, place)                                                                                                                                                                                                                                                                                                                                                         |
| `FavouriteService.List/Add/RemoveFavourite` | newest first; add/remove idempotent; max 200                                                                                                                                                                                                                                                                                                                                             |
| `CreditService.GetCreditAccount`            | balance + history newest first, paged (20, max 100). Unknown customer = Rs 0, no error                                                                                                                                                                                                                                                                                                   |
| `CreditService.ChangeCredit`                | see "Credit" below                                                                                                                                                                                                                                                                                                                                                                       |
| `PlusService.GetPlusMembership`             | `NONE` when never joined. `renews_at` while a member                                                                                                                                                                                                                                                                                                                                     |
| `PlusService.JoinPlus`                      | idempotent on `idempotency_key`. `PLUS_PLAN_REQUIRED`, `PLUS_CARD_REQUIRED`, `PLUS_ALREADY_MEMBER`. First join = 30-day free month; Rs 990/month or Rs 9,900/year. `card_label` from ids like `visa-4242`, else "Saved card". Emits `PlusMembershipChanged`                                                                                                                              |
| `PlusService.CancelPlus`                    | `PLUS_NOT_MEMBER`. `ends_at` = next renewal; benefits (`active`, `Customer.plus_active`) last until then                                                                                                                                                                                                                                                                                 |

#### Credit

`ChangeCredit` amounts are signed LKR minor units. `ORDER_SPEND` must be negative; `ADJUSTMENT` either
sign; everything else positive (`AMOUNT_SIGN_INVALID`). `ORDER_SPEND` and `ORDER_SPEND_REVERSED` need
`order_id` (`ORDER_ID_REQUIRED`).

- The customer row is locked, so concurrent spends can't overdraw: `FAILED_PRECONDITION CREDIT_INSUFFICIENT`.
- Idempotent on `idempotency_key` (scope: the customer). Retrying returns the stored response;
  reusing a key with a different body is `IDEMPOTENCY_KEY_REUSED`.
- **Saga contract:** spend with `reason=ORDER_SPEND, amount=-X, order_id, idempotency_key="order:<id>:credit"`;
  compensate with `reason=ORDER_SPEND_REVERSED, amount=+X, order_id, idempotency_key="order:<id>:credit:reverse"`.
  The reversal returns **at most what that order actually spent** (net of earlier reversals). If
  nothing was spent (the spend failed or never arrived), it succeeds with no `entry` and the current
  balance. It also leaves a tombstone, so a spend for that order that arrives _after_ its
  compensation fails with `ORDER_CREDIT_REVERSED` instead of charging a dead order.
- Every movement writes a `CreditEntry` with `balance_after` and emits `CustomerCreditChanged`.

### kade.identity.v1

| RPC                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PhoneSignInService.StartPhoneSignIn`            | Normalises to E.164 (`PHONE_INVALID`). 30 s between codes and 5 codes per 15 min per number (`RESOURCE_EXHAUSTED OTP_RATE_LIMITED`, metadata `retryAfterSeconds`). Code stored hashed, valid 5 min                                                                                                                                                                                     |
| `PhoneSignInService.VerifyPhoneSignIn`           | `OTP_INVALID` (metadata `attemptsLeft`), 5 attempts then `OTP_RATE_LIMITED`, used/expired/unknown `FAILED_PRECONDITION OTP_EXPIRED`. Finds or creates the Keycloak user (username = E.164 digits, e.g. `94771234567`) and returns its tokens; for the customer app it also ensures the customer (phone set, `is_new` while nameless). Keycloak down: `UNAVAILABLE SIGN_IN_UNAVAILABLE` |
| `StaffService.ListStaff` / `GetPermissionMatrix` | any staff role                                                                                                                                                                                                                                                                                                                                                                         |
| `StaffService.InviteStaff`                       | admin. `@kade.lk` only (`STAFF_EMAIL_INVALID`), `STAFF_EXISTS`. Recorded as INVITED                                                                                                                                                                                                                                                                                                    |
| `StaffService.ChangeStaffRole` / `RemoveStaff`   | admin. `LAST_ADMIN`, `STAFF_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                 |
| `StaffService.SavePermissionMatrix`              | admin. The admin row always has every permission; `PERMISSION_UNKNOWN`                                                                                                                                                                                                                                                                                                                 |
| `AuditService.RecordAudit`                       | any caller (gateways). Actor defaults to the caller's metadata, `actor_name` to the staff member's name. Idempotent on `idempotency_key`. Marks the actor active on the team page. `AUDIT_ACTION_REQUIRED`, `AUDIT_RECORD_TYPE_REQUIRED`                                                                                                                                               |
| `AuditService.ListAuditEntries`                  | staff. Filter by record type/id and actor; newest first; 50 per page (max 200)                                                                                                                                                                                                                                                                                                         |

**Dev OTP:** with `OTP_MODE=dev` (the default, and what Compose sets) no SMS is sent and **every code
is `123456`** (`OTP_DEV_CODE`), the same demo code the apps show. `OTP_MODE=sms` generates random codes
and sends them through `notification.SendNotification` (template `otp`, transactional).

**Minting tokens in dev:** Keycloak token exchange needs preview features the dev realm doesn't
enable. After a correct code, profile sets a fresh random password on the _phone_ user (never stored
or returned) and runs a password grant for the app's public client (`customer-app`, `rider-app` or
`merchant-app`; direct-access grants are on in the dev realm). Tokens have the usual
`iss = http://localhost:8080/realms/kade` and `azp` = that client. Only users whose username is the
phone number are touched, so demo users keep `kade123`. Phone sign-in therefore creates a separate
account from a password user with the same phone. Swap this for token exchange in production.

**Staff:** the staff table is the source of truth for the team page. Demo Keycloak staff (`admin`,
`ops`, `finance`, `support`) are rows keyed by their sub; the admin console's mock team S-1…S-8 are
`00000000-0000-7000-8006-<N>`. Invites don't create Keycloak accounts or send email in dev.

## Events

Out (`kade.customer.events`, `aggregatetype = customer`, key = customer id, value = protobuf):

| `eventType`                              | When                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `kade.profile.v1.CustomerRegistered`     | first EnsureCustomer (or first write) for a customer; carries `referral_code` for promotion |
| `kade.profile.v1.CustomerProfileUpdated` | UpdateProfile, or EnsureCustomer filling blanks                                             |
| `kade.profile.v1.CustomerBlockChanged`   | block/unblock                                                                               |
| `kade.profile.v1.CustomerCreditChanged`  | every credit movement (ledger's customer-credit liability)                                  |
| `kade.profile.v1.PlusMembershipChanged`  | join, rejoin, cancel                                                                        |
| `kade.profile.v1.FraudFlagRaised`        | a risk rule fires (or the seed)                                                             |

In (deduplicated through `processed_events`; events for customers profile has never seen are ignored):

| Event                                                        | Effect                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `kade.order.v1.OrderDelivered`, `OrderCollected`             | `orders_count + 1`, `spend += totals.total`, `last_order_at`                              |
| `kade.order.v1.OrderRefunded`                                | refund signal: 3 in 7 days → open REFUNDS flag ("3 refunds in 7 days, Rs 7,850 refunded") |
| `kade.order.v1.OrderCancelled` (by or fault of the customer) | 3 in 30 days → CANCELLATIONS flag                                                         |
| `kade.payment.v1.PaymentDeclined`                            | 3 in 2 hours → PAYMENT_FAILURES flag                                                      |

At most one open flag per kind per customer.

## Seed data

Applied once per database on start (`seed_runs` table; `SEED_DEMO_DATA=false` turns it off). Seeded
changes go through the outbox like any other, so ledger sees the demo credit.

- **Dilini** (`dilini`, sub `00000000-0000-7000-8005-000000000001`): Dilini Perera, `+94771234567`,
  `dilini@kade.test`; addresses **Home** "42 Galle Rd, Colombo 03" (Kollupitiya, zone `c03`, "Green
  gate next to the pharmacy") and **Work** "18 Bauddhaloka Mawatha, Colombo 07" (Cinnamon Gardens,
  `c07`, "Leave it at reception, 3rd floor"); **Rs 500 referral credit** "Kasun's first order, from
  your invite"; favourites restaurants 2 (Amma's Rice & Curry) and 12 (`…-8000-000000000002`,
  `…-8000-000000000012`; override with `SEED_FAVOURITE_RESTAURANT_IDS`).
  If a realm ever has different subs, the first EnsureCustomer with `dilini@kade.test` applies the
  same profile.
- **36 admin-console customers** (`00000000-0000-7000-8002-<N>`, N = 2040, 2047, … as the mock's
  `C-N`): names, phones, emails, home address and zone, join date, order count/spend/last order,
  some goodwill credit; open flags on C-2089 (refunds), C-2124 (cancellations), C-2173 (card
  declines; plus a cleared one); **C-2250 Ameer Hamza blocked** ("Used 11 new accounts to claim
  FIRSTKOTTU").
- **Staff:** the 4 Keycloak staff users and the mock team S-1…S-8 (S-8 invited), the default
  permission matrix, and 9 audit entries.

Other users (ruwan, kasun, nimal, any new sign-up) become customers on their first EnsureCustomer.

## Configuration

Template variables (`SERVICE_NAME`, `GRPC_PORT`, `HTTP_PORT`, `DATABASE_URL`, `KAFKA_BROKERS`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`, …) plus:

| Variable                                                               | Default                                       |                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `KEYCLOAK_URL`                                                         | unset (phone verify then fails `UNAVAILABLE`) | `http://keycloak:8080` in Compose                       |
| `KEYCLOAK_REALM` / `KEYCLOAK_ADMIN_REALM` / `KEYCLOAK_ADMIN_CLIENT_ID` | `kade` / `master` / `admin-cli`               |                                                         |
| `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD`                      | `admin` / `admin`                             | dev master admin                                        |
| `OTP_MODE` / `OTP_DEV_CODE`                                            | `dev` / `123456`                              |                                                         |
| `PRICING_GRPC`                                                         | unset                                         | zone lookup on SaveAddress (optional; failures ignored) |
| `NOTIFICATION_GRPC`                                                    | unset                                         | OTP SMS in `sms` mode                                   |
| `SEED_DEMO_DATA`                                                       | `true`                                        |                                                         |
| `SEED_FAVOURITE_RESTAURANT_IDS`                                        | restaurants 2 and 12                          | comma-separated                                         |

## Running

```sh
pnpm infra:up
# on the host
cp services/profile/.env.example services/profile/.env
pnpm --filter @kade/proto build
pnpm --filter @kade/profile dev
# in Docker (once services/profile/compose.yaml is in deploy/compose/services.yaml)
docker compose -f deploy/compose/compose.yaml --profile ordering up -d --build profile
# image only
docker build -f services/profile/Dockerfile -t kade/profile:dev .
```

After the first start (migrations create `outbox`), register the connector once:

```sh
deploy/compose/connect/register-outbox.sh profile profile
```

Try it with the generated client (no gRPC reflection):

```sh
cd services/profile && node --input-type=module -e '
import { credentials, Metadata } from "@grpc/grpc-js";
import { CustomerServiceClient } from "@kade/proto/kade/profile/v1/profile_service";
const c = new CustomerServiceClient("localhost:50103", credentials.createInsecure());
const md = new Metadata(); md.set("x-user-id", "00000000-0000-7000-8005-000000000001"); md.set("x-roles", "customer");
c.getCustomerDetail({ customerId: "00000000-0000-7000-8005-000000000001" }, md, (e, r) => { console.dir(e ?? r, { depth: 5 }); c.close(); });'
```

## Testing

```sh
pnpm --filter @kade/profile test                # unit: rules, validation, paging, phone, seed data
pnpm --filter @kade/profile test:integration    # shared stack: Postgres, Kafka + Debezium, Keycloak
```

The integration suites boot the app in-process on random ports against the shared `profile` database
(default `localhost:15432`; override `DATABASE_URL`, `KAFKA_BROKERS`, `KEYCLOAK_URL`). They cover the
seed, EnsureCustomer, access rules, addresses, favourites, preferences, the credit saga semantics
(idempotent spend, overdraft and concurrency, capped reversal, late spend), Plus, block/flags (the
risk consumer handlers run in a real transaction), outbox → Debezium → `kade.customer.events`, phone
sign-in against Keycloak, staff and audit. Test customers use `it-` ids and are deleted afterwards;
Keycloak users created by phone sign-in are removed too.
