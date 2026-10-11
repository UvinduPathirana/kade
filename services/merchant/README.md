# merchant

Restaurant partners as businesses: outlets (`outlet_id` = catalog `restaurant_id`), their staff,
busy mode / pause / ops status / tablet connectivity / commission, partner onboarding, and the
**kitchen board** (tickets projected from `kade.order.events`, plus the kitchen's own decisions).
Built from `services/_templates/ts` (see its README for the platform pieces).

- **Ports:** gRPC 50109, HTTP 8109 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `merchant` (login `merchant`): `outlets`, `outlet_staff`, `tickets`,
  `partner_applications`, `demo_seeds`, plus `outbox`, `processed_events`, `idempotency_keys`
- **Events out:** aggregate `merchant` → `kade.merchant.events` (outbox, key = outlet id)
- **Events in:** `kade.order.events`, `kade.delivery.events` (group `merchant`, idempotent)

## API (`kade.merchant.v1`)

| Service                     | RPCs                                                                                                                                                          | Who                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `KitchenService`            | `ListTickets`, `GetTicket`, `AcceptOrder`, `RejectOrder`, `MarkOrderReady`, `HandOverOrder`                                                                   | outlet team (kitchen+), ops                         |
| `OutletService`             | `GetOutlet`, `SetBusyMode`, `PauseOutlet`, `ResumeOutlet`, `ReportTabletHeartbeat`, `GetOutletSettings`, `UpdateOutletSettings` (manager+), `PrintTestTicket` | outlet team, ops                                    |
| `OutletStaffService`        | `ListOutletStaff`, `InviteOutletStaff` / `ChangeOutletStaffRole` / `RemoveOutletStaff` (owner), `GetMyOutlets`                                                | outlet team; `GetMyOutlets` = any signed-in user    |
| `PartnerApplicationService` | `SubmitApplication`, `GetMyApplication` (anyone, by phone), `ListApplications`, `GetApplication`, `SetApplicationDocumentStatus`, `DecideApplication` (ops)   |                                                     |
| `OutletAdminService`        | `ListOutlets`, `GetOutletAdmin`, `UpdateCommission` (ops/finance), `SetOutletStatus` (ops)                                                                    | ops, admin, support (+finance for reads/commission) |

### Identity and authorisation (merchant gateway)

Gateways pass `x-user-id` (Keycloak `sub`), `x-roles`, and optionally `x-outlet-id`.

1. At sign-in the gateway calls **`OutletStaffService.GetMyOutlets`** with `x-user-id`; it returns
   `[{outlet_id, outlet_name, role}]` from `outlet_staff.user_id`. Use that outlet as `x-outlet-id`
   (and/or `outlet_id` in requests).
2. Every outlet-scoped RPC checks: ops/admin/support → any outlet; otherwise the caller must be on
   that outlet's team with the required role (kitchen < manager < owner). A caller **not** on the
   team is accepted only if the gateway vouched with `x-outlet-id` = that outlet and a merchant role
   (`merchant_owner` → owner, `merchant_staff` → kitchen) — this keeps the gateway's dev fallback
   working. `x-outlet-id` must match the request's outlet. An empty `outlet_id` falls back to
   `x-outlet-id`, then to the caller's only outlet.
3. Seeded links (no Keycloak lookups; ids from CONVENTIONS "Seeded ids"): **ruwan**
   `00000000-0000-7000-8005-000000000002` = owner and **kasun** `…-8005-000000000003` = kitchen at
   **Galle Road Kottu House** `00000000-0000-7000-8000-000000000001`.
4. Invited staff are `pending` with no `user_id` until linked (there is no phone claim in the token
   yet, so linking a new invitee to a Keycloak user is a follow-up).

### Ticket lifecycle and timing

```
new ──AcceptOrder (before accept_by)──▶ preparing ──MarkOrderReady──▶ ready ──HandOverOrder──▶ picked_up
 ├──RejectOrder(reason)──▶ rejected
 └──accept_by passes────▶ missed      (AcceptOrder/RejectOrder → FAILED_PRECONDITION TICKET_MISSED)
any open ticket ──OrderCancelled──▶ cancelled
```

- A ticket is created from `OrderPlaced` (order status PLACED) or `OrderReleasedToKitchen`
  (scheduled orders). `accept_by` comes from the order, else placed/released + **3 minutes**.
- The order workflow's 3-minute timer is the authority. Merchant also refuses accepts/rejects after
  `accept_by` (`TICKET_MISSED`) and marks such tickets `missed` itself (on read, on a late accept,
  and in a 15 s housekeeping sweep) without publishing anything; `OrderRejected(TIMEOUT)` confirms it.
- Errors: `TICKET_ALREADY_ACCEPTED`, `TICKET_NOT_NEW`, `TICKET_NOT_PREPARING`, `TICKET_NOT_READY`,
  `TICKET_CLOSED`, `TICKET_NOT_FOUND`, `PREP_MINUTES_INVALID` (1–120), `REJECT_REASON_INVALID`
  (TIMEOUT is not a kitchen reason).
- Accept adds busy-mode minutes: `prep_minutes` in the response/event = chosen + busy (0/10/20);
  `ready_by` = now + that.
- Every decision is one transaction (ticket row lock + update + outbox + idempotency key);
  retries with the same `idempotency_key` return the stored response.
- Tickets only move forward (new < preparing < ready < final). Late/replayed events are no-ops;
  order's final word replaces ours (e.g. our accept that lost the race to the timeout becomes
  `missed` when `OrderRejected(TIMEOUT)` arrives).
- `ListTickets`: open tickets plus those closed within `closed_within_minutes` (default 60), oldest first.

### Events

Out (`kade.merchant.events`, key = outlet id): `TicketAccepted`, `TicketRejected`, `TicketReady`,
`TicketHandedOver`, `OutletStatusChanged` (busy, pause, resume, pause expiry, ops status, tablet
online/silent — `previous` → `status`), `OutletCommissionChanged`, `PartnerApplicationSubmitted`
(key = application id), `PartnerApplicationDecided` (key = new outlet id on approval),
`OutletStaffInvited`.

In:

| Topic                  | Events                                                                                               | Effect                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `kade.order.events`    | `OrderPlaced`, `OrderReleasedToKitchen`                                                              | create ticket                                               |
|                        | `OrderAccepted`, `OrderPreparing`, `OrderReady`, `OrderPickedUp`, `OrderDelivered`, `OrderCollected` | move forward (snapshot events also create a missing ticket) |
|                        | `OrderRejected` (TIMEOUT → missed), `OrderCancelled`                                                 | close                                                       |
|                        | `OrderRiderChanged`                                                                                  | rider on the ticket                                         |
| `kade.delivery.events` | `RiderAssigned`, `RiderUnassigned`, `RiderArrivedAtRestaurant`, `DeliveryPickedUp`                   | rider strip, at-counter flag, picked up                     |

### Outlet status

`accepting` = ops status OPEN ∧ not paused ∧ tablet online (no heartbeat ever, or one within the last
5 minutes). Pause: future time, ≤ 24 h. Busy: 0, 10 or 20. Commission: 0–3500 bps.

### Onboarding

`SubmitApplication` (signed out) validates and normalises the phone (+94…), stores the bank account
number but only ever returns `account_last4`, gives a `KP-NNNNN` reference. One open application per
phone (`APPLICATION_PENDING`); a `CHANGES_REQUESTED` one is replaced on resubmission.
`DecideApplication(APPROVED)` approves pending documents (`DOCUMENTS_NOT_APPROVED` if any was
rejected), creates the outlet with **id = application id** (closed, "New partner: menu being set
up", commission default 1800), adds the owner as a pending team member, publishes
`PartnerApplicationDecided`, then calls `catalog.CreateRestaurant` (idempotent on restaurant id;
`CATALOG_GRPC`). If catalog is unreachable the approval stands and approving again retries the call.

## Seed data (at boot, insert-if-absent; `SEED_DATA=false` disables)

- 16 outlets, one per restaurant of the apps' mock catalogue, ids `…-8000-0000000000NN`, with the
  admin console's names, zones, cuisines, commission (Kadé Market 0%, Sakura 20%, Amma's 15%, else
  18%), statuses (Ceylon Fried Chicken paused, Donut Republic closed, Wood & Fire and Jaffna Curry
  Pot tablets silent).
- Galle Road Kottu House team: Mohamed Rizwan (owner), Ruwan Fernando (owner, Keycloak ruwan),
  Chathuri Perera (manager), Saman Kumara, Kasun Silva (Keycloak kasun), Ashan Silva (kitchen),
  Nadeesha Fernando (pending invite). Every other outlet: its owner. Staff ids `…-8d01-…`.
- Three pending partner applications (Hela Bojun Hala, Kottu Lab, Lassana Bakes), ids `…-8d02-…`.
- **Demo kitchen board** (`DEMO_BOARD=true`): a busy evening on Galle Road Kottu House — 3 picked up,
  1 missed, 1 ready with the rider at the counter, 2 preparing, 3 new — tickets KD-2401…2410.
  They are `tickets.source = 'demo'` with order ids in group **`…-8d00-…`** (never produced by
  order). Kitchen actions on them work but publish nothing. Re-laid when older than 2 hours (checked
  on `ListTickets`), so the board is never stale. Real tickets have `source = 'order'`.

## Run alone

```sh
pnpm infra:up
cp services/merchant/.env.example services/merchant/.env    # Postgres on 15432 on this laptop
pnpm --filter @kade/merchant dev
deploy/compose/connect/register-outbox.sh merchant merchant  # once, after the first start
```

In Docker: `docker compose -f deploy/compose/compose.yaml --profile fulfilment up -d --build merchant`.

## Test

```sh
pnpm --filter @kade/merchant test               # unit: state machine, mapping, validation, consumers
pnpm --filter @kade/merchant test:integration   # shared stack: gRPC, Kafka in, outbox → Debezium → Kafka out
```

The integration suite boots the app in-process and drives real events through Kafka: OrderPlaced →
ticket (with replays), accept/ready/hand-over with idempotency and the outbox, TicketAccepted on
`kade.merchant.events` via Debezium, late accept → TICKET_MISSED, order timeout beating an accept,
rider events, busy/pause, staff and LAST_OWNER, and onboarding → approval → admin controls. It
resets Galle Road Kottu House's busy/pause afterwards.
