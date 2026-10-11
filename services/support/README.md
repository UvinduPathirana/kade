# support

Owns tickets: chats from the customer, rider and restaurant apps, order-issue reports, SLAs,
assignment, macros, help topics, and resolution with money. Money goes back through
**`order.RefundOrder`**, either to card or to Kadé credit on an order, or through
**`profile.ChangeCredit`** for goodwill credit without an order. Refunds therefore have one path and one
ledger trail. Ticket events are published through the outbox.

Scaffolded from `services/_templates/ts`; see that README for the platform pieces.

- **Owns:** `tickets`, `ticket_messages`, `order_issues`, `macros`
- **API:** `kade.support.v1.SupportService` (apps) and `kade.support.v1.TicketAdminService` (admin console;
  roles `support`, `ops`, `admin`)
- **Events out:** aggregate `ticket` → `kade.ticket.events`: `TicketOpened`, `TicketMessageAdded`,
  `TicketAssigned`, `TicketPriorityChanged`, `TicketSlaBreached`, `TicketResolved`, `TicketReopened`,
  `OrderIssueReported`
- **Events in:** none
- **Calls:** `order` (`ORDER_GRPC`, default `order:50107`) for `GetOrder` and `RefundOrder`; `profile`
  (`PROFILE_GRPC`, default `profile:50103`) for `ChangeCredit`. Every call has a 2 s deadline
  (`GRPC_CLIENT_TIMEOUT_MS`).
- **Ports:** gRPC 50116, HTTP 8116. **Database:** `support` (login `support`).

## API

| RPC                                 | Notes                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreviewOrderIssue`                 | Customer app `issueAmount` rules: missing/wrong/spilled = Σ unit price × min(qty, ordered) × (1 − discount); late = max(delivery fee, Rs 200); never arrived = total + credit; charged = 0                                                                                                                                                                                             |
| `ReportOrderIssue`                  | Opens an issue-report ticket. For CREDIT or CARD it calls `RefundOrder` (idempotency key `issue:<order id>`) inside the transaction and resolves the ticket. For REVIEW, and always for CHARGED, the ticket waits for an agent. Reasons: `ISSUE_ALREADY_REPORTED`, `ORDER_NOT_ARRIVED`, `CASH_ORDER_REFUND_TO_CREDIT`, `ISSUE_LINES_REQUIRED`, `ISSUE_NOTE_REQUIRED`, `NOT_YOUR_ORDER` |
| `BatchGetOrderIssues`               | Gateways join issues onto orders                                                                                                                                                                                                                                                                                                                                                       |
| `GetOrStartConversation`            | Returns the requester's open chat, or opens one with Tharushi's greeting. Can attach an order.                                                                                                                                                                                                                                                                                         |
| `SendMessage`                       | Requester's message. The first one gets an automatic acknowledgement. A message on a resolved chat reopens it.                                                                                                                                                                                                                                                                         |
| `ListMessages`, `ListHelpTopics`    | Help topics per audience (rider app topics, plus customer and restaurant), hotline +94 11 750 0500                                                                                                                                                                                                                                                                                     |
| `ListTickets`, `GetTicket`          | Filters: status, category, priority, assignee, unassigned, SLA breached, order, requester                                                                                                                                                                                                                                                                                              |
| `ReplyToTicket`                     | Sets `first_response_at`, moves open → pending, and claims an unassigned ticket                                                                                                                                                                                                                                                                                                        |
| `AssignTicket`, `SetTicketPriority` | Priority recomputes `sla_due_at` from `opened_at`                                                                                                                                                                                                                                                                                                                                      |
| `ResolveTicket`                     | **REFUND**: checks the remaining amount and the card/cash rule, then calls `order.RefundOrder`. **CREDIT**: customers only, Rs 1–5,000, through `profile.ChangeCredit`. **NONE**. The idempotency key also keys the upstream call.                                                                                                                                                     |
| `ReopenTicket`, `ListMacros`        |                                                                                                                                                                                                                                                                                                                                                                                        |

**SLA.** Time to first response: urgent 15 min, high 1 h, normal 4 h, low 24 h. `SlaMonitor` checks every
30 s and publishes `TicketSlaBreached` once per unanswered ticket. It uses `SKIP LOCKED`, so it is safe
across replicas.

**Order down.** If order (or profile) is unreachable, slow, or doesn't implement the RPC, the call fails
fast with `UNAVAILABLE` and reason `ORDER_SERVICE_UNAVAILABLE` (or `PROFILE_SERVICE_UNAVAILABLE`), with
the message "We couldn't reach the order service, so nothing was refunded. Try again in a minute."
Nothing is written, and the ticket stays open. Business errors from order, such as
`REFUND_EXCEEDS_REMAINING`, pass through with order's reason.

## Seed data (`SEED_DEMO_DATA=true`, idempotent)

- **The admin console's 12 tickets (T-3301…T-3312),** with messages, assignees, a pending ticket and a
  resolved one. Times are relative to the first boot.
- **The 5 macros.**

Ids follow docs/backend/CONVENTIONS.md "Seeded ids": customers `8002` (C-N), riders `8001`, restaurant 7
`8000`, orders `8003` (KD-N), staff `8006` (S-N). Support-private groups are `8b01` (tickets,
T-3300+n → n) and `8b02` (messages).

## Run alone

```sh
pnpm infra:up
cp services/support/.env.example services/support/.env
pnpm --filter @kade/support dev
deploy/compose/connect/register-outbox.sh support support    # once, after the first start
```

## Test

```sh
pnpm --filter @kade/support test               # unit: rules, SLA, upstream error mapping
pnpm --filter @kade/support test:integration   # shared stack + in-process fake order/profile gRPC
```

The integration suite starts a fake order/profile gRPC server in-process. That lets it check refund
calls, idempotency keys and the order-down path without a running order service.
