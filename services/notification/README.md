# notification

Sends Kadé's SMS, push and email. It is mostly a pure event consumer: order, delivery, payment,
ticket and merchant events become messages to the right person, in the apps' voice ("Nimal is on the
way with your order from Galle Road Kottu House."). There are no real providers in dev. A **dev sink**
logs every message (Loki: `{service_name="notification"} |= "dev-sink"`) and the service stores it, so
ops and support can see exactly what was sent through `ListNotifications`.

Scaffolded from `services/_templates/ts`; see that README for the platform pieces.

- **Owns:** `notifications` (every message, rendered body, status, provider ref), `push_devices`,
  `order_contacts` (who to tell about an order, built from order/delivery events).
- **API:** `kade.notification.v1.NotificationService`
- **Events out:** none
- **Events in (group `notification`):** `kade.order.events`, `kade.delivery.events`,
  `kade.payment.events`, `kade.ticket.events`, `kade.merchant.events`
- **Ports:** gRPC 50114, HTTP 8114 (`/health/live`, `/health/ready`, `/metrics`)
- **Database:** `notification` (login `notification`). No outbox connector needed.

## API

| RPC                                           | Who                                              | Notes                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SendNotification`                            | services (profile OTP, dispatch masked messages) | Renders `template` with `params`; idempotent on `idempotency_key`; `send_at` in the future → `QUEUED`, sent by the dispatcher (5 s tick). Reasons: `TEMPLATE_UNKNOWN`, `TEMPLATE_PARAM_MISSING`, `RECIPIENT_REQUIRED`, `RECIPIENT_PHONE_REQUIRED`, `RECIPIENT_EMAIL_REQUIRED` |
| `GetNotification`                             | owner, ops/support/admin                         | `NOTIFICATION_NOT_FOUND`                                                                                                                                                                                                                                                      |
| `ListNotifications`                           | owner, ops/support/admin                         | By `user_id` or `reference_id` (order id, ticket id), newest first, cursor = last id                                                                                                                                                                                          |
| `RegisterPushDevice` / `UnregisterPushDevice` | gateways                                         | Upsert per (user, device)                                                                                                                                                                                                                                                     |

**Channel routing.** Unspecified channel = the template's default. Push needs a registered device. With
none, it falls back to SMS when the order gave us a phone number. Otherwise the row is stored as
`SUPPRESSED` with the reason, so support can see we tried.

## Events → messages

| Event                                          | Template                                        | Example                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `OrderPlaced`                                  | `order_placed` / `order_scheduled`              | We've sent order KD-4821 to Galle Road Kottu House. We'll let you know as soon as they accept.             |
| `OrderAccepted`                                | `order_accepted` / `order_accepted_pickup`      | Galle Road Kottu House accepted order KD-4821 and is cooking now. About 30 min to go.                      |
| `OrderRejected`                                | `order_rejected`                                | Sorry, … couldn't take order KD-4821: they're too busy right now. The hold on your card has been released. |
| `OrderReady` (pickup)                          | `order_ready_pickup`                            | Order KD-4821 is ready to collect at …                                                                     |
| `RiderAssigned` (delivery)                     | `rider_assigned`                                | Nimal is picking up your order from Galle Road Kottu House.                                                |
| `OrderPickedUp`                                | `order_picked_up`                               | Nimal is on the way with your order from Galle Road Kottu House.                                           |
| `RiderArrivedAtCustomer`                       | `rider_arrived`                                 | Nimal is at your gate with order KD-4821. Have your delivery code ready.                                   |
| `OrderDelivered` / `OrderCollected`            | `order_delivered` / `order_collected`           | … has been delivered. Enjoy your meal, and tap to rate Nimal and the food.                                 |
| `OrderCancelled`                               | `order_cancelled` / `order_cancelled_by_kade`   |                                                                                                            |
| `OrderRefunded`                                | `order_refunded_credit` / `order_refunded_card` | Rs 450 for order KD-4821 is back in your Kadé credit, ready to use now.                                    |
| `PaymentDeclined`, `PaymentRefundFailed`       | `payment_declined`, `payment_refund_failed`     |                                                                                                            |
| `TicketMessageAdded` (agent), `TicketResolved` | `ticket_reply`, `ticket_resolved`               | Tharushi from Kadé support: …                                                                              |
| `OutletStaffInvited`                           | `staff_invite` (SMS)                            |                                                                                                            |

The full order snapshots (`OrderPlaced`, `OrderAccepted`, `OrderDelivered`, …) fill `order_contacts`.
Progress events, which carry ids only, read names and phone numbers from there. Every consumer-sent
message has the idempotency key `evt:<event id>:<template>`, and the runner dedups on
`processed_events`, so a redelivered event never sends twice. Templates live in
`src/notifications/templates.ts`.

## Run alone

```sh
pnpm infra:up
cp services/notification/.env.example services/notification/.env
pnpm --filter @kade/notification dev
```

## Test

```sh
pnpm --filter @kade/notification test               # unit: templates, routing, consumers (fakes)
pnpm --filter @kade/notification test:integration   # shared stack: gRPC, Kafka → messages, dedup
```

The integration suite defaults to this laptop's Postgres port (15432). Override it with `DATABASE_URL`.
