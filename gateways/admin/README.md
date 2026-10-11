# gateway-admin (`@kade/gateway-admin`)

Backend-for-frontend for the **Kadé Ops console** (`apps/admin`, port 5177). HTTP **8204**, Compose
profile `engagement`. Built from `gateways/_template` (Fastify 5 + TypeBox, Keycloak JWT, gRPC
upstreams, problem+json, OpenAPI); see that README for the shared mechanics.

It serves exactly the shapes `apps/admin/src/api/` returns (whole rupees, epoch-millisecond times,
numeric restaurant ids, `KD-4821` order ids), so the console's components don't change. The
gateway does the joins and aggregation, checks every route against the staff permission matrix, and
writes an audit entry (identity `AuditService.RecordAudit`) for every staff change.

## Upstreams

| Variable                     | Service                                                                             | Used for                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ORDER_GRPC` (50107)         | order `OrderService`                                                                | orders, refunds, cancel, notes; customer order history; dashboard fallback |
| `DISPATCH_GRPC` (50110)      | dispatch `DispatchOpsService`, `RiderService`                                       | live snapshot, nearby riders, reassign; riders and rider onboarding        |
| `MERCHANT_GRPC` (50109)      | merchant `OutletAdminService`, `PartnerApplicationService`                          | restaurants, commission, status; restaurant onboarding                     |
| `CATALOG_GRPC` (50101)       | catalog `MerchandisingService`                                                      | home feed categories and collections                                       |
| `PROFILE_GRPC` (50103)       | profile `CustomerService`, `CreditService`; identity `StaffService`, `AuditService` | customers, credit, blocks, fraud flags; staff, permissions, audit          |
| `PRICING_GRPC` (50105)       | pricing `PricingService`                                                            | zones, fees, surcharges (and zone shapes for map positions)                |
| `PROMOTION_GRPC` (50106)     | promotion `VoucherService`                                                          | vouchers                                                                   |
| `LEDGER_GRPC` (50113)        | ledger `PayoutService`, `RiderFinanceService`, `LedgerService`                      | payouts, rider settlements, cash deposits, refunds ledger                  |
| `SUPPORT_GRPC` (50116)       | support `TicketAdminService`                                                        | support queue                                                              |
| `REALTIME_WS_URL` (optional) | realtime `:8112/ws`                                                                 | `/ws` is relayed there after auth when set                                 |

A route whose service is down answers `503` problem+json; optional joins (customer emails, outlet
names on payouts, zone shapes, refund counts) degrade instead of failing the response. Nothing is a
hard Compose dependency except Keycloak.

## Endpoints → console functions

All under `/v1`, `Authorization: Bearer <admin-app token>`. Full schemas: `openapi.json`
(`pnpm --filter @kade/gateway-admin openapi`).

| Console function (`apps/admin/src/api`)                                                          | Endpoint                                                                                                                                  | Permission                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `getLiveSnapshot`                                                                                | `GET /live` (cached 2.5 s; poll every 5 s)                                                                                                | any staff                                                              |
| `listOrders` / `getOrder`                                                                        | `GET /orders`, `GET /orders/:id` (`KD-4821` or UUID)                                                                                      | `orders.view`                                                          |
| `listNearbyRiders` / `reassignRider`                                                             | `GET /orders/:id/nearby-riders`, `POST /orders/:id/reassign`                                                                              | `orders.reassign`                                                      |
| `refundOrder`                                                                                    | `POST /orders/:id/refunds`                                                                                                                | `orders.refundSmall` (≤ Rs 5,000) or `orders.refundAny`                |
| `cancelOrder`                                                                                    | `POST /orders/:id/cancel`                                                                                                                 | `orders.cancel`                                                        |
| `addOrderNote`                                                                                   | `POST /orders/:id/notes`                                                                                                                  | `orders.view`                                                          |
| `listPayoutBatches` / `approvePayoutBatch`                                                       | `GET /finance/payouts`, `POST /finance/payouts/:id/approve`                                                                               | read: any finance permission; approve: `finance.payouts`               |
| `listRiderSettlements` / `settleRider`                                                           | `GET /finance/settlements`, `POST /finance/settlements/:riderId/settle`                                                                   | settle: `finance.cash`                                                 |
| `listCashRecords` / `recordDeposit`                                                              | `GET /finance/cash`, `POST /finance/cash/:id/deposit`                                                                                     | deposit: `finance.cash`                                                |
| `listRefunds`                                                                                    | `GET /finance/refunds`                                                                                                                    | any finance permission                                                 |
| `listRestaurants` / `listRestaurantApplications`                                                 | `GET /restaurants`, `GET /restaurant-applications`                                                                                        | any staff                                                              |
| `decideRestaurantApplication` / `setRestaurantDocStatus`                                         | `POST /restaurant-applications/:id/decision`, `POST …/:id/documents/:docId`                                                               | `partners.approve`                                                     |
| `updateCommission`                                                                               | `PUT /restaurants/:id/commission`                                                                                                         | `partners.commission`                                                  |
| `setRestaurantStatus`                                                                            | `PUT /restaurants/:id/status`                                                                                                             | `partners.suspend`                                                     |
| `listRiders` / `listRiderApplications` / `listZones`                                             | `GET /riders`, `GET /rider-applications`, `GET /zones`                                                                                    | any staff                                                              |
| `reviewRiderDoc` / `decideRiderApplication`                                                      | `POST /rider-applications/:id/documents/:docId`, `POST …/:id/decision`                                                                    | `partners.approve`                                                     |
| `setRiderZones` / `setRiderSuspended`                                                            | `PUT /riders/:id/zones`, `PUT /riders/:id/suspension`                                                                                     | `partners.approve`/`partners.suspend`; `partners.suspend`              |
| `listCustomers` / `getCustomer`                                                                  | `GET /customers`, `GET /customers/:id`                                                                                                    | `orders.view`                                                          |
| `issueCredit`                                                                                    | `POST /customers/:id/credit`                                                                                                              | `customers.credit` (Rs 5,000 cap; admins Rs 50,000)                    |
| `resolveFlag` / `setBlocked`                                                                     | `POST /customers/:id/flags/:flagId`, `PUT /customers/:id/block`                                                                           | `customers.block`                                                      |
| `getPricing`                                                                                     | `GET /pricing`                                                                                                                            | any staff                                                              |
| `setZoneOpen` / `updateZoneFees` / `saveSurcharge` / `setSurchargeEnabled` / `setWeather`        | `PUT /zones/:id/open`, `PUT /zones/:id/fees`, `POST /surcharges`, `PUT /surcharges/:id/enabled`, `PUT /weather`                           | `pricing.edit`                                                         |
| `listVouchers` / `createVoucher` / `setVoucherStatus`                                            | `GET /vouchers`, `POST /vouchers`, `PUT /vouchers/:code/status`                                                                           | writes: `promos.edit`                                                  |
| `listTickets` / `listMacros`                                                                     | `GET /tickets`, `GET /macros`                                                                                                             | role support, ops or admin                                             |
| `replyToTicket` / `assignTicket` / `setTicketPriority` / `reopenTicket`                          | `POST /tickets/:id/replies`, `PUT …/assignee`, `PUT …/priority`, `POST …/reopen`                                                          | role support, ops or admin                                             |
| `resolveTicket`                                                                                  | `POST /tickets/:id/resolve`                                                                                                               | support/ops/admin, plus the refund or credit permission for the amount |
| `listStaffNames`                                                                                 | `GET /staff/names`                                                                                                                        | any staff                                                              |
| `getHomeContent`                                                                                 | `GET /content`                                                                                                                            | any staff                                                              |
| `moveCategory` / `updateCategory` / `saveCollection` / `setCollectionVisible` / `moveCollection` | `POST /content/categories/:id/move`, `PATCH /content/categories/:id`, `POST /content/collections`, `PUT …/:id/visible`, `POST …/:id/move` | `content.edit`                                                         |
| `listStaff` / `getPermissions` / `listAudit`                                                     | `GET /team/staff`, `GET /team/permissions`, `GET /audit`                                                                                  | any staff                                                              |
| `inviteStaff` / `changeRole` / `savePermissions`                                                 | `POST /team/staff`, `PUT /team/staff/:id/role`, `PUT /team/permissions`                                                                   | `team.manage`                                                          |
| shell (signed-in staff)                                                                          | `GET /me`                                                                                                                                 | any staff                                                              |

**Roles and permissions.** Every route needs a staff realm role (`ops`, `finance`, `support`,
`admin`; customers, riders and merchants get 403). Writes are checked against the role → permission
matrix the Team page edits (identity `StaffService.GetPermissionMatrix`, cached 30 s); while identity
is unreachable the console's original grid (`src/permissions.ts`) applies. Admins can do everything.

**Ids.** Seeded UUIDs (CONVENTIONS "Seeded ids") read as the console's ids: restaurants `…-8000-N`
→ `N`; riders `R-101`, customers `C-2040`, Keycloak staff `U-5`, other staff `S-1`. Other UUIDs
pass through (other outlets get a stable number above 10¹²). Orders use `order_number`. Audit
entries are stored with service ids and shown with console ids.

**Live dashboard.** `GET /live` uses dispatch's `GetLiveSnapshot` when dispatch is up; otherwise it
aggregates in the gateway: active and today's orders (order), not-accepting kitchens (merchant),
riders and cash over limit (dispatch rider list, if reachable), zone load and riders needed
(pricing), and last week's same day for the hourly chart.

## Run on the host

```sh
pnpm infra:up                                       # shared stack (Keycloak on :8080)
cp gateways/admin/.env.example gateways/admin/.env  # upstreams on localhost ports
pnpm --filter @kade/proto build
pnpm --filter @kade/gateway-admin dev               # :8204

# a real staff token (password grant is enabled for dev):
TOKEN=$(curl -s -d grant_type=password -d client_id=admin-app -d username=ops -d password=kade123 \
  http://localhost:8080/realms/kade/protocol/openid-connect/token | jq -r .access_token)
curl -s localhost:8204/v1/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:8204/v1/orders -H 'Authorization: Bearer dev:ops-1:ops'   # AUTH_DEV_BYPASS
```

Docker: `docker compose -f deploy/compose/compose.yaml --profile engagement up -d --build gateway-admin`
(once the lead includes `gateways/admin/compose.yaml` in `deploy/compose/services.yaml`).

## Test

```sh
pnpm --filter @kade/gateway-admin test   # routes via inject/injectWS with fake upstreams; JWT with a local JWKS
```
