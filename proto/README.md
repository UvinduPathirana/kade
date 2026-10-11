# Kadé contracts

Protobuf contracts for every Kadé service: gRPC APIs (`<domain>_service.proto`) and Kafka event
messages (`<domain>_events.proto`). Rules live in [`docs/backend/CONVENTIONS.md`](../docs/backend/CONVENTIONS.md);
the plan in [`BACKEND.md`](../BACKEND.md).

```sh
cd proto && npx buf lint          # STANDARD rules
pnpm proto:gen                    # gen/ts (@kade/proto) + gen/go, then builds @kade/proto
```

> `buf.gen.yaml` has `clean: true` and Go generates into `gen/go`, which is also the Go module root, so
> `buf generate` deletes `gen/go/go.mod` and `go.sum`. Until the template is changed, restore them after
> generating: `git checkout -- gen/go/go.mod gen/go/go.sum`.

## Packages

| Package | Served by | Services (RPCs) | Events file → topic |
| --- | --- | --- | --- |
| `kade.common.v1` | — | shared: `Money`, `GeoPoint`, `PageRequest/Response`, `Actor`, `Address`, `Contact`, `PaymentMethod`, `FulfilmentMode`, `RefundMethod`, `SubstitutionPreference`, `DayOfWeek`, `DateRange`, `PartnerDocument`, `BankAccount`, `ApplicationStatus` | — |
| `kade.catalog.v1` | catalog :50101 | CatalogService (8), MenuManagementService (9), RestaurantManagementService (6), MerchandisingService (7) | `kade.restaurant.events`, `kade.menu.events` |
| `kade.search.v1` | search :50102 | SearchService (5) | — |
| `kade.profile.v1` | profile :50103 | CustomerService (9), AddressService (4), FavouriteService (3), CreditService (2), PlusService (3) | `kade.customer.events` |
| `kade.identity.v1` | profile :50103 | PhoneSignInService (2), StaffService (6), AuditService (2) | — |
| `kade.cart.v1` | cart :50104 | CartService (7) | — |
| `kade.pricing.v1` | pricing :50105 | PricingService (11) | — |
| `kade.promotion.v1` | promotion :50106 | PromotionService (6), VoucherService (4), OfferService (3), GiftCardService (3), ReferralService (1) | `kade.promotion.events` |
| `kade.order.v1` | order :50107 | OrderService (11), GroupOrderService (6) | `kade.order.events` |
| `kade.payment.v1` | payment :50108 | PaymentService (8), SavedCardService (4), PspWebhookService (1) | `kade.payment.events` |
| `kade.merchant.v1` | merchant :50109 | KitchenService (6), OutletService (8), OutletStaffService (4), PartnerApplicationService (6), OutletAdminService (4) | `kade.merchant.events` |
| `kade.dispatch.v1` | dispatch :50110 | DispatchService (14), DispatchOpsService (4), RiderService (12) | `kade.delivery.events` (+ proposed `kade.rider.events`) |
| `kade.location.v1` | location :50111 | LocationService (4) | `kade.rider.locations` (`RiderLocation`, Schema Registry) |
| `kade.realtime.v1` | realtime :8112 (WebSocket) | none — WebSocket frame types only | — |
| `kade.ledger.v1` | ledger :50113 | LedgerService (6), RestaurantFinanceService (4), PayoutService (4), RiderFinanceService (8) | `kade.ledger.events` |
| `kade.notification.v1` | notification :50114 | NotificationService (5) | — |
| `kade.review.v1` | review :50115 | ReviewService (8) | `kade.review.events` |
| `kade.support.v1` | support :50116 | SupportService (7), TicketAdminService (8) | `kade.ticket.events` |

`kade.template.v1` is the service-template example and is not part of the product.

## How the apps' data maps onto the contracts

- **Money:** every amount is `kade.common.v1.Money` in LKR minor units. Gateways divide by 100 for the
  apps, which show whole rupees (`Rs 1,150`). Percentages round to whole rupees, as the apps do.
- **Ids:** UUIDv7 strings everywhere. The apps' numeric restaurant ids (`1`, `2`, …) become strings;
  merchant's `outlet_id` is the same value as catalog's `restaurant_id`. Orders also carry
  `order_number` (`KD-4821`); the kitchen ticket shows its digits.
- **Times:** `google.protobuf.Timestamp` (ts-proto gives `Date`); whole days are ISO date strings in
  Asia/Colombo (`"2026-10-12"`), opening-hour times are `"HH:MM"`.
- **Map:** services use WGS84 `GeoPoint`; the apps draw an illustrated map, so gateways convert to
  and from map units (`pin {x, y}`, `MapPoint`).
- **Enums → app strings:** gateways map `ORDER_STATUS_PICKED_UP` → `"pickedUp"`, etc.
- **Ops-only fields** (order notes, real phone numbers) are stripped by the customer, merchant and rider
  gateways.
- **Joins in gateways:** an order's rating (`review.BatchGetOrderRatings`) and reported issue
  (`support.BatchGetOrderIssues`) live with their owners; gateways join them onto the order. Same for
  "ordered before" on restaurant cards (`order.ListOrders` by customer).

## Errors

gRPC status codes plus `google.rpc.ErrorInfo{reason, domain: "<service>.kade.lk", metadata}`. Reasons
used in the contracts' comments are stable API: e.g. `CART_EMPTY`, `ADDRESS_REQUIRED`, `OUT_OF_ZONE`,
`RESTAURANT_CLOSED`, `ITEM_SOLD_OUT`, `PRICE_CHANGED`, `PAYMENT_DECLINED`, `CUSTOMER_BLOCKED`,
`ORDER_ALREADY_STARTED`, `CASH_TIP_AT_DOOR`, `REFUND_EXCEEDS_REMAINING`, `CASH_ORDER_REFUND_TO_CREDIT`,
`TICKET_MISSED`, `TICKET_ALREADY_ACCEPTED`, `TICKET_NOT_PREPARING`, `OFFER_EXPIRED`,
`ITEMS_NOT_CHECKED`, `DELIVERY_CODE_MISMATCH`, `CASH_SHORT`, `CREDIT_INSUFFICIENT`, `CARD_ALREADY_SAVED`,
`OTP_INVALID`, `OTP_RATE_LIMITED`, `LAST_ADMIN`, `LAST_OWNER`, `ISSUE_ALREADY_REPORTED`,
`ORDER_NOT_ARRIVED`, `GROUP_CLOSED`, `GROUP_LIMIT_EXCEEDED`, `ENTRY_UNBALANCED`, `BATCH_NOT_DRAFT`,
`DOCUMENTS_NOT_APPROVED`, `ZONES_REQUIRED`, `VOUCHER_ENDED`, and promo failures as
`PROMO_<PromoRejection>` (`PROMO_MIN_SUBTOTAL`, `PROMO_WRONG_RESTAURANT`, …). Gateways map reasons to
the messages the apps already show.

## Order state machine

`kade.order.v1.OrderStatus` is the single source of truth; each app sees its own vocabulary.

```
PENDING ──saga ok──▶ PLACED ─accept─▶ ACCEPTED ─▶ PREPARING ─▶ READY ─┬─rider────▶ PICKED_UP ─▶ DELIVERED
   │       └future─▶ SCHEDULED ─kitchen start time─▶ PLACED           └─pickup───▶ COLLECTED
   └─saga failed─▶ FAILED
PLACED ─reject / 3-min timeout─▶ REJECTED
SCHEDULED, PLACED ─customer─▶ CANCELLED;   any non-final ─ops/system─▶ CANCELLED
```

| OrderStatus | Customer app | Restaurant ticket (`merchant.TicketStatus`) | Admin |
| --- | --- | --- | --- |
| PENDING | (checkout spinner) | — | — |
| SCHEDULED | scheduled | — (ticket appears at release) | placed |
| PLACED | placed | new | placed |
| ACCEPTED | accepted | preparing | accepted |
| PREPARING | preparing | preparing | preparing |
| READY | delivery: preparing · pickup: ready | ready | ready |
| PICKED_UP | pickedUp | pickedUp | pickedUp |
| DELIVERED | delivered | pickedUp | delivered |
| COLLECTED | collected | pickedUp | delivered |
| CANCELLED | cancelled | cancelled | cancelled |
| REJECTED | cancelled (with reason) | missed (reason TIMEOUT) / rejected | rejected |
| FAILED | (checkout error) | — | — |

## Order saga (Temporal workflow in `order`, workflow id = order id)

1. **Validate and price.** `order.OrderService/PlaceOrder` (idempotency key) inserts a `PENDING` order and
   starts the workflow, then waits for it to reach PLACED/SCHEDULED/FAILED.
   `profile.CustomerService/GetCustomer` (blocked? Plus active?) →
   `catalog.CatalogService/ValidateCart` (sold out, closed, server prices) →
   `pricing.PricingService/ResolveZone` (delivery) →
   `promotion.PromotionService/EvaluateRestaurantOffer` (restaurant saving / free delivery) →
   `pricing.PricingService/QuoteCart` (subtotal for the promo check) →
   `promotion.PromotionService/ValidatePromo` (if a code) →
   `profile.CreditService/GetCreditAccount` (if use credit) →
   `pricing.PricingService/QuoteCart` (final totals; must equal `expected_total` or `PRICE_CHANGED`).
2. **Reserve promo.** `promotion.PromotionService/ReservePromo` (`order:<id>:promo`).
   Compensation: `promotion.PromotionService/ReleasePromo`.
   **Spend credit.** `profile.CreditService/ChangeCredit` (negative, `ORDER_SPEND`, `order:<id>:credit`).
   Compensation: `profile.CreditService/ChangeCredit` (positive, `ORDER_SPEND_REVERSED`, `order:<id>:credit:reverse`).
3. **Authorise payment.** `payment.PaymentService/AuthorisePayment` (`order:<id>:authorise`). Card →
   `AUTHORISED` or `DECLINED`; cash → `CASH_DUE` (intent only). Skipped when credit covers the total.
   Declined → run compensations, order `FAILED` (`OrderFailed`), `PlaceOrder` returns
   `FAILED_PRECONDITION`/`PAYMENT_DECLINED`. Compensation: `payment.PaymentService/VoidPayment`.
4. **Create order.** Status `PLACED` (or `SCHEDULED`) and `OrderPlaced` through the outbox in one
   transaction; `PlaceOrder` returns; the gateway calls `cart.CartService/ClearCart`. Scheduled orders:
   the workflow sleeps until `scheduled_for − lead time`, then `PLACED` + `OrderReleasedToKitchen`.
5. **Wait for the restaurant.** merchant projects `OrderPlaced`/`OrderReleasedToKitchen` into a ticket
   (`accept_by` = now + 3 min). The kitchen calls `merchant.KitchenService/AcceptOrder` or
   `merchant.KitchenService/RejectOrder`; merchant emits `TicketAccepted` / `TicketRejected`; order's
   consumer signals the workflow. A 3-minute workflow timer races the signal. On reject or timeout:
   `payment.PaymentService/VoidPayment`, `promotion.PromotionService/ReleasePromo`,
   `profile.CreditService/ChangeCredit` (reverse) → `REJECTED` + `OrderRejected` (notification tells the
   customer; merchant marks the ticket missed/rejected).
6. **Accepted.** `ACCEPTED` + `OrderAccepted` (full snapshot), then `PREPARING` + `OrderPreparing`.
   From here it is choreography: dispatch consumes `OrderAccepted` → `DeliveryRequested` →
   `DeliveryOfferSent` (30 s; `DeliveryOfferExpired` → next rider) → `dispatch.DispatchService/AcceptOffer`
   → `RiderAssigned` → order stores the rider (`OrderRiderChanged`).
   `merchant.KitchenService/MarkOrderReady` → `TicketReady` → `READY` + `OrderReady`.
7. **Pickup and delivery.** `dispatch.DispatchService/ConfirmPickup` → `DeliveryPickedUp` → `PICKED_UP` +
   `OrderPickedUp`, and the workflow calls `payment.PaymentService/CapturePayment` (card).
   `dispatch.DispatchService/CompleteDelivery` → `DeliveryCompleted` → `DELIVERED` + `OrderDelivered`.
   payment consumes `DeliveryCompleted` for cash orders (`PaymentCaptured`, method CASH,
   `collected_by_rider_id`). `OrderDelivered` → ledger (postings), review (rating opens), notification,
   promotion (`RedeemPromo`, `OfferRedeemed`, referral rewards).
   Pickup orders: `READY` → `order.OrderService/MarkCollected` or `merchant.KitchenService/HandOverOrder`
   (`TicketHandedOver`) → `COLLECTED` + `OrderCollected`; card captured then; cash at the counter is
   recorded with `payment.PaymentService/RecordCashCollection` (no rider) and netted off the
   restaurant's payout by ledger.

Cancellation: `order.OrderService/CancelOrder` signals the workflow. Before capture it runs the step-5
compensations; after capture it refunds through `order.OrderService/RefundOrder`. Dispatch consumes
`OrderCancelled` (`DeliveryCancelled`, rider compensated if already on the way).

## Cash on delivery

1. `AuthorisePayment` with `PAYMENT_METHOD_KIND_CASH` → `CASH_DUE`; `Delivery.cash_to_collect` = order total,
   `customer_pays_with` tells the rider what change to bring.
2. `CompleteDelivery` requires `cash_collected ≥ cash_to_collect` (`CASH_SHORT`). `DeliveryCompleted`
   → payment marks the payment `CAPTURED` (`PaymentCaptured`, rider id) → ledger
   `Dr RIDER_CASH_HELD / Cr ORDER_CLEARING`, and credits rider pay to `RIDER_PAYABLE`.
3. Ledger publishes `RiderCashBalanceChanged` (holding = collected − owed to rider, limit, over_limit);
   dispatch stops offering cash orders to riders over the limit.
4. The rider deposits at a deposit point; finance matches the slip with
   `ledger.RiderFinanceService/RecordCashDeposit` (`Dr BANK / Cr RIDER_CASH_HELD`), or the cash is netted
   against earnings in `ledger.RiderFinanceService/SettleRider`.
5. Cash orders are never refunded in cash: `RefundOrder` with `REFUND_METHOD_CREDIT` only.

## Realtime

`realtime` has no gRPC API. It consumes the topics below, maps events to `kade.realtime.v1.RealtimeMessage`
on channels (`order:<id>`, `customer:<id>`, `group:<id>`, `outlet:<id>`, `restaurant:<id>`, `rider:<id>`,
`ticket:<id>`, `ops:live`), fans out through Redis pub/sub (`rt:<channel>`), and serves WebSockets on
`:8112/ws`. Gateways validate the JWT and reverse-proxy `/ws` to realtime with `x-user-id`, `x-roles`,
`x-outlet-id`; realtime authorises each `Subscribe`. Frames are proto3 JSON of `ClientFrame` /
`ServerFrame`. There is deliberately no Publish RPC: anything pushed is already an event, so pushes are
replayable and there is one path. Clients refetch over REST after reconnecting.

## Topics

| Topic (key) | Producer | Event types | Main consumers |
| --- | --- | --- | --- |
| `kade.restaurant.events` (restaurant_id) | catalog | `RestaurantCreated`, `RestaurantUpdated`, `RestaurantAvailabilityChanged`, `RestaurantHoursChanged` | search, realtime, merchant |
| `kade.menu.events` (restaurant_id) | catalog | `MenuUpdated`, `MenuItemAvailabilityChanged` | search, realtime |
| `kade.customer.events` (customer_id) | profile | `CustomerRegistered`, `CustomerProfileUpdated`, `CustomerBlockChanged`, `CustomerCreditChanged`, `PlusMembershipChanged`, `FraudFlagRaised` | ledger, promotion (referrals), notification |
| `kade.promotion.events` (code / offer / gift card / customer id) | promotion | `VoucherCreated`, `VoucherStatusChanged`, `OfferActivated`, `OfferEnded`, `PromoReserved`, `PromoReleased`, `PromoRedeemed`, `OfferRedeemed`, `GiftCardPurchased`, `GiftCardSent`, `GiftCardRedeemed`, `ReferralRewarded` | catalog (offer label), ledger, notification |
| `kade.order.events` (order_id; group events: group_id) | order | `OrderPlaced`, `OrderReleasedToKitchen`, `OrderAccepted`, `OrderRejected`, `OrderPreparing`, `OrderReady`, `OrderRiderChanged`, `OrderPickedUp`, `OrderDelivered`, `OrderCollected`, `OrderCancelled`, `OrderFailed`, `OrderTipUpdated`, `OrderRefunded`, `GroupOrderUpdated` | merchant, dispatch, ledger, review, notification, promotion, profile, realtime |
| `kade.payment.events` (payment_id) | payment | `PaymentAuthorised`, `PaymentDeclined`, `PaymentAuthorisationAdjusted`, `PaymentCaptured`, `PaymentVoided`, `PaymentRefunded`, `PaymentRefundFailed` | order, ledger, profile (fraud), promotion (gift cards), notification |
| `kade.merchant.events` (outlet_id) | merchant | `TicketAccepted`, `TicketRejected`, `TicketReady`, `TicketHandedOver`, `OutletStatusChanged`, `OutletCommissionChanged`, `PartnerApplicationSubmitted`, `PartnerApplicationDecided`, `OutletStaffInvited` | order (workflow signals), catalog, ledger, dispatch, realtime, notification |
| `kade.delivery.events` (delivery_id) | dispatch | `DeliveryRequested`, `DeliveryOfferSent`, `DeliveryOfferDeclined`, `DeliveryOfferExpired`, `RiderAssigned`, `RiderUnassigned`, `RiderArrivedAtRestaurant`, `DeliveryPickedUp`, `RiderArrivedAtCustomer`, `DeliveryCompleted`, `DeliveryMatchingFailed`, `DeliveryCancelled` | order, payment, ledger, merchant, realtime, notification |
| `kade.rider.events` (rider_id) — **proposed, not yet in the registry** | dispatch | `RiderApplicationSubmitted`, `RiderApplicationDecided`, `RiderStatusChanged` | notification, ledger (online minutes), realtime |
| `kade.rider.locations` (rider_id) | location (direct, Schema Registry) | `RiderLocation` | dispatch (GEO), realtime |
| `kade.ledger.events` (owner / batch id) | ledger | `JournalEntryPosted`, `StatementIssued`, `PayoutBatchApproved`, `PayoutCompleted`, `RiderSettled`, `RiderPayoutCompleted`, `CashDepositRecorded`, `RiderCashBalanceChanged` | dispatch (cash limit), notification |
| `kade.review.events` (order / restaurant / rider id) | review | `OrderRated`, `ReviewReplied`, `RestaurantRatingChanged`, `RiderRatingChanged`, `TripFeedbackSubmitted` | catalog, search, dispatch, notification |
| `kade.ticket.events` (ticket_id) | support | `TicketOpened`, `TicketMessageAdded`, `TicketAssigned`, `TicketPriorityChanged`, `TicketSlaBreached`, `TicketResolved`, `TicketReopened`, `OrderIssueReported` | realtime, notification, profile (fraud) |

Every event message carries its aggregate id as field 1 and an `occurred_at` Timestamp. Events that
start downstream work carry full snapshots (`Order`, `Restaurant`, `Menu`, `Delivery`, …) so consumers
don't call back.

## Services and RPCs

**`kade.catalog.v1.CatalogService`**

| RPC | What it does |
| --- | --- |
| `ListCategories` | Food categories for the home rail and the category page ("Kottu", "Short eats", …). |
| `GetCategory` | One category for the category page header. |
| `ListRestaurants` | Restaurants for the home feed/category page, with distance, ETA and delivery fee for `deliver_to`. |
| `GetRestaurant` | One restaurant with distance/ETA/fee for `deliver_to`. |
| `BatchGetRestaurants` | Several restaurants by id (favourites, order history, collections). |
| `GetMenu` | Full menu: sections, popular dishes and option groups. |
| `GetHomeFeed` | Home feed: visible categories plus banners and shelves with their restaurants resolved. |
| `ValidateCart` | Saga step 1: checks every line against the live menu (exists, not sold out, options valid) and the restaurant against hours/pause/closures at `fulfil_at`, and returns server-side unit prices. |

**`kade.catalog.v1.MenuManagementService`**

| RPC | What it does |
| --- | --- |
| `SaveMenuItem` | Creates the item when `item.id` is empty, otherwise updates it (and moves it if section_id changed). |
| `DeleteMenuItem` | Removes a dish. |
| `SetMenuItemSoldOut` | Sold out today; resets automatically at the next opening. |
| `CreateMenuSection` | Adds a section (unique name). |
| `RenameMenuSection` | Renames a section. |
| `DeleteMenuSection` | Removes an empty section. |
| `MoveMenuSection` | Moves a section up or down. |
| `SaveOptionGroup` | Creates or updates an option group ("Spice level", "Add-ons"). |
| `DeleteOptionGroup` | Removes an option group and detaches it from items. |

**`kade.catalog.v1.RestaurantManagementService`**

| RPC | What it does |
| --- | --- |
| `CreateRestaurant` | Called by merchant when an application is approved (idempotent on restaurant_id). |
| `UpdateRestaurantDetails` | Name, address, phone, cuisine, image, price level, location. |
| `GetOpeningHours` | Weekly hours and special closures. |
| `SetOpeningHours` | Replaces the weekly hours (ranges may pass midnight). |
| `AddClosure` | Special closure for a whole day (Poya, holidays). |
| `RemoveClosure` | Removes a special closure. |

**`kade.catalog.v1.MerchandisingService`**

| RPC | What it does |
| --- | --- |
| `ListHomeCategories` | Every category, including hidden ones, in display order. |
| `UpdateHomeCategory` | Label, image or visibility of a category. |
| `MoveHomeCategory` | Reorders a category. |
| `ListCollections` | Banners and shelves, including hidden ones. |
| `SaveCollection` | Creates (empty id) or updates a banner/shelf collection. |
| `SetCollectionVisible` | Shows or hides a collection. |
| `MoveCollection` | Reorders a collection. |

**`kade.search.v1.SearchService`**

| RPC | What it does |
| --- | --- |
| `Search` | Dishes and restaurants matching every word of the query; open places and name matches first, sold-out dishes after available ones. |
| `ListPopularSearches` | Suggestions under the empty search box. |
| `SearchPlaces` | Address picker: places/landmarks matching the query, each marked in or out of the delivery zone. |
| `ReverseGeocode` | Reverse lookup for a dragged pin: the nearest named place. |
| `RebuildIndex` | Ops: drop the projection and rebuild it by replaying the catalog topics from the beginning. |

**`kade.profile.v1.CustomerService`**

| RPC | What it does |
| --- | --- |
| `GetCustomer` | The customer profile. |
| `EnsureCustomer` | Creates the customer on first sign-in (idempotent on customer_id); returns is_new for the name step. |
| `UpdateProfile` | Name and email. |
| `GetPreferences` | Notification, dietary and language preferences. |
| `UpdatePreferences` | Replaces preferences. |
| `ListCustomers` | Admin: customers list with search. |
| `GetCustomerDetail` | Admin: one customer with stats, flags and credit history. |
| `SetCustomerBlocked` | Blocks/unblocks a customer with a reason (ops). |
| `ResolveFraudFlag` | Clears or actions a fraud flag (ops). |

**`kade.profile.v1.AddressService`**

| RPC | What it does |
| --- | --- |
| `ListAddresses` | Saved addresses. |
| `SaveAddress` | Adds a new address, or replaces the one with the same id. |
| `RemoveAddress` | Deletes a saved address. |
| `JoinWaitlist` | "Tell me when you deliver here." |

**`kade.profile.v1.FavouriteService`**

| RPC | What it does |
| --- | --- |
| `ListFavourites` | Favourite restaurants. |
| `AddFavourite` | Adds a favourite restaurant. |
| `RemoveFavourite` | Removes a favourite restaurant. |

**`kade.profile.v1.CreditService`**

| RPC | What it does |
| --- | --- |
| `GetCreditAccount` | Balance and history of Kadé credit. |
| `ChangeCredit` | Adds (positive) or spends (negative) credit. |

**`kade.profile.v1.PlusService`**

| RPC | What it does |
| --- | --- |
| `GetPlusMembership` | Plus status, plan, trial and renewal dates. |
| `JoinPlus` | Starts the free month; the card is charged (payment, purpose PLUS) when it ends. |
| `CancelPlus` | Benefits last until the end of the period already paid for. |

**`kade.identity.v1.PhoneSignInService`**

| RPC | What it does |
| --- | --- |
| `StartPhoneSignIn` | Sends a 6-digit code. |
| `VerifyPhoneSignIn` | Checks the code; returns Keycloak tokens. |

**`kade.identity.v1.StaffService`**

| RPC | What it does |
| --- | --- |
| `ListStaff` | Kadé staff accounts. |
| `InviteStaff` | Must be an @kade.lk email; sends an invite email. |
| `ChangeStaffRole` | Fails with reason LAST_ADMIN if it would leave no admin. |
| `RemoveStaff` | Removes a staff account. |
| `GetPermissionMatrix` | Permissions and which roles have them. |
| `SavePermissionMatrix` | Replaces the role → permission matrix. |

**`kade.identity.v1.AuditService`**

| RPC | What it does |
| --- | --- |
| `RecordAudit` | Appends an audit entry for a staff action. |
| `ListAuditEntries` | Audit log, filterable by record or actor. |

**`kade.cart.v1.CartService`**

| RPC | What it does |
| --- | --- |
| `GetCart` | The customer's cart and checkout options. |
| `AddCartLine` | Adds a dish (merges with an identical line: same item, options and note). |
| `UpdateCartLine` | Quantity 0 removes the line. |
| `RemoveCartLine` | Removes one line. |
| `ClearCart` | Empties the cart. |
| `UpdateCheckoutOptions` | Checkout choices: mode, address, schedule, payment, promo code, tip, credit, notes. |
| `GetCartQuote` | Validates (catalog), checks the promo (promotion) and prices (pricing): the checkout preview. |

**`kade.pricing.v1.PricingService`**

| RPC | What it does |
| --- | --- |
| `QuoteCart` | Prices a cart. |
| `QuoteDeliveryFee` | Delivery fee for one restaurant → location, line by line (admin fee preview, catalog cards). |
| `BatchQuoteDeliveryFees` | Many restaurants to one location; catalog uses it to fill Restaurant.delivery_fee on listings. |
| `ResolveZone` | Which zone a point is in (address picker "in zone?", order zone_id, dispatch). |
| `GetPricingConfig` | Admin: zones, surcharge rules and the rain surcharge in one read. |
| `ListZones` | Delivery zones and their fees. |
| `SetZoneOpen` | Opens/closes a zone for delivery. |
| `UpdateZoneFees` | Base, per-km and small-order fees of a zone. |
| `SaveSurchargeRule` | Creates (empty id) or updates a time-window surcharge ("Dinner peak"). |
| `SetSurchargeRuleEnabled` | Turns a surcharge rule on or off. |
| `SetWeatherSurcharge` | Turns the rain surcharge on/off and sets its amount. |

**`kade.promotion.v1.PromotionService`**

| RPC | What it does |
| --- | --- |
| `ListPublicPromos` | Codes anyone can use right now, for the customer offers page. |
| `ValidatePromo` | Checks a code for a basket without reserving anything (cart preview, saga step 2 pre-check). |
| `ReservePromo` | Saga step 2: re-validates and holds the discount against budget and limits. |
| `ReleasePromo` | Gives a held reservation back to the budget (compensation). |
| `RedeemPromo` | Makes a reservation permanent. |
| `EvaluateRestaurantOffer` | The restaurant's running automatic offer applied to a basket (saving / free delivery). |

**`kade.promotion.v1.VoucherService`**

| RPC | What it does |
| --- | --- |
| `ListVouchers` | Vouchers by status. |
| `GetVoucher` | One voucher with uses, spend and reservations. |
| `CreateVoucher` | Codes are 4–16 letters and numbers. |
| `SetVoucherStatus` | Pause/resume/end. |

**`kade.promotion.v1.OfferService`**

| RPC | What it does |
| --- | --- |
| `ListOffers` | The restaurant's offers (active, scheduled, ended). |
| `CreateOffer` | Creates a restaurant-funded offer with a budget. |
| `EndOffer` | Ends an active offer now, or cancels a scheduled one. |

**`kade.promotion.v1.GiftCardService`**

| RPC | What it does |
| --- | --- |
| `ListGiftCards` | Gift cards the customer bought. |
| `BuyGiftCard` | Charges the card (payment, purpose GIFT_CARD) and schedules delivery on send_on. |
| `RedeemGiftCard` | Recipient redeems the code into Kadé credit (profile.ChangeCredit, reason GIFT_CARD). |

**`kade.promotion.v1.ReferralService`**

| RPC | What it does |
| --- | --- |
| `GetReferral` | The customer's invite code and who has used it. |

**`kade.order.v1.OrderService`**

| RPC | What it does |
| --- | --- |
| `PlaceOrder` | Runs saga steps 1–4 synchronously (validate, price, reserve promo, spend credit, authorise payment, create order) and returns the PLACED/SCHEDULED order. |
| `GetOrder` | By id or order_number. |
| `BatchGetOrders` | Several orders by id. |
| `ListOrders` | Customer history, restaurant board, rider history or the ops list, depending on filters. |
| `GetActiveOrder` | Most recent non-final order for a customer, if any. |
| `CancelOrder` | Customer: only SCHEDULED or PLACED (reason ORDER_ALREADY_STARTED otherwise). |
| `MarkCollected` | Pickup orders: the customer (or the kitchen via merchant HandOverOrder) confirms collection. |
| `UpdateTip` | Card orders only (reason CASH_TIP_AT_DOOR for cash). |
| `RefundOrder` | Partial or full refund to card (payment.RefundPayment) or Kadé credit (profile.ChangeCredit). |
| `ListOrderRefunds` | Refunds on one order. |
| `AddOrderNote` | Internal ops note on the order. |

**`kade.order.v1.GroupOrderService`**

| RPC | What it does |
| --- | --- |
| `CreateGroupOrder` | Opens a group order with a closing time and optional per-person limit. |
| `GetGroupOrder` | Fails with NOT_FOUND reason GROUP_CLOSED once placed or closed. |
| `JoinGroupOrder` | A friend joins from the share link. |
| `SetGroupMemberLines` | Replaces a member's dishes; enforces the per-person limit (reason GROUP_LIMIT_EXCEEDED). |
| `LeaveGroupOrder` | A member leaves (their dishes go). |
| `CloseGroupOrder` | Host closes without ordering. |

**`kade.payment.v1.PaymentService`**

| RPC | What it does |
| --- | --- |
| `AuthorisePayment` | Saga step 3. |
| `AdjustAuthorisation` | Changes an open authorisation (tip changed after placing). |
| `CapturePayment` | Captures up to the authorised amount (card) — at pickup. |
| `RecordCashCollection` | Records cash taken at the door (normally driven by DeliveryCompleted; exposed for ops corrections). |
| `VoidPayment` | Releases an authorisation / cancels a cash intent. |
| `RefundPayment` | Card refund, partial or full, of a captured payment. |
| `GetPayment` | One payment with its refunds. |
| `ListPayments` | By order or customer. |

**`kade.payment.v1.SavedCardService`**

| RPC | What it does |
| --- | --- |
| `ListSavedCards` | The customer's saved cards (brand, last4, expiry). |
| `CreateCardSetupSession` | Starts a card-capture session with the PSP; the app posts the card to the PSP's hosted fields with client_secret and gets back a token. |
| `AddSavedCard` | Saves the PSP token (duplicate card: ALREADY_EXISTS reason CARD_ALREADY_SAVED). |
| `RemoveSavedCard` | Deletes a saved card and its PSP token. |

**`kade.payment.v1.PspWebhookService`**

| RPC | What it does |
| --- | --- |
| `HandlePspWebhook` | Verifies the signature, deduplicates on the PSP event id and applies the outcome. |

**`kade.merchant.v1.KitchenService`**

| RPC | What it does |
| --- | --- |
| `ListTickets` | The live board: non-final tickets plus those closed in the last hour, oldest first. |
| `GetTicket` | One kitchen ticket. |
| `AcceptOrder` | Accept with a prep time (busy-mode minutes are added). |
| `RejectOrder` | Rejects with a reason (too busy, sold out, closing soon, other) and note. |
| `MarkOrderReady` | Only from PREPARING (reason TICKET_NOT_PREPARING). |
| `HandOverOrder` | Rider took the bag (delivery) or the customer collected it (pickup). |

**`kade.merchant.v1.OutletService`**

| RPC | What it does |
| --- | --- |
| `GetOutlet` | Outlet details and status (busy, pause, ops status, accepting). |
| `SetBusyMode` | Extra minutes on every order's prep time: 0, 10 or 20. |
| `PauseOutlet` | Stop new orders until `until`. |
| `ResumeOutlet` | Ends a pause now. |
| `ReportTabletHeartbeat` | Tablet heartbeat; an outlet whose tablet goes silent stops "accepting" (ops attention item). |
| `GetOutletSettings` | Printer/device and notification settings. |
| `UpdateOutletSettings` | Replaces device and notification settings. |
| `PrintTestTicket` | Sends a sample ticket to the paired printer. |

**`kade.merchant.v1.OutletStaffService`**

| RPC | What it does |
| --- | --- |
| `ListOutletStaff` | The outlet's team. |
| `InviteOutletStaff` | Sends an SMS invite; pending until first sign-in. |
| `ChangeOutletStaffRole` | Fails with LAST_OWNER if it would leave no owner. |
| `RemoveOutletStaff` | Removes a team member. |

**`kade.merchant.v1.PartnerApplicationService`**

| RPC | What it does |
| --- | --- |
| `SubmitApplication` | Restaurant onboarding form (restaurant app, signed out). |
| `GetMyApplication` | The applicant's own application, by phone (x-user-id). |
| `ListApplications` | Admin review queue. |
| `GetApplication` | One application with documents. |
| `SetApplicationDocumentStatus` | Approves or rejects one document with a reason. |
| `DecideApplication` | Approve (creates the outlet and calls catalog.CreateRestaurant), request changes or reject. |

**`kade.merchant.v1.OutletAdminService`**

| RPC | What it does |
| --- | --- |
| `ListOutlets` | Restaurants with orders/week, acceptance rate, commission and status. |
| `GetOutletAdmin` | One restaurant's admin view. |
| `UpdateCommission` | 0%–35%. |
| `SetOutletStatus` | Open / pause / suspend / close with a reason. |

**`kade.dispatch.v1.DispatchService`**

| RPC | What it does |
| --- | --- |
| `SetAvailability` | Go online/offline. |
| `GetCurrentOffer` | The rider's open offer, if any (polling fallback). |
| `AcceptOffer` | Fails with FAILED_PRECONDITION reason OFFER_EXPIRED ("It's gone to another rider"). |
| `DeclineOffer` | Declines with a reason; dispatch offers the next rider. |
| `GetActiveJob` | The rider's current delivery. |
| `ArriveAtRestaurant` | Records arrival so waiting time can be paid. |
| `ReportFoodNotReady` | The food isn't ready; returns the kitchen's ready_by. |
| `ConfirmPickup` | Every item ticked or the bag sealed (reason ITEMS_NOT_CHECKED otherwise). |
| `ArriveAtCustomer` | Records arrival at the drop-off. |
| `CompleteDelivery` | Proof (code or photo) and cash. |
| `SendCustomerMessage` | Quick reply to the customer through masked messaging (notification sends it). |
| `ListTrips` | Completed trips, newest first. |
| `GetTrip` | One completed trip. |
| `ListQuests` | Trip-count bonuses and boosts in progress. |

**`kade.dispatch.v1.DispatchOpsService`**

| RPC | What it does |
| --- | --- |
| `GetLiveSnapshot` | Live dashboard: counts, attention items, orders by hour, map dots, zone load. |
| `ListNearbyRiders` | Riders near an order's restaurant, for manual assignment. |
| `ReassignRider` | The new rider has to collect it again if it was already picked up. |
| `GetDelivery` | One delivery with its offer history. |

**`kade.dispatch.v1.RiderService`**

| RPC | What it does |
| --- | --- |
| `GetRiderProfile` | The rider's profile, vehicle, rating and bank (last4). |
| `ListRiderDocuments` | The rider's documents and their status. |
| `SubmitRiderApplication` | Rider onboarding form with documents and bank details. |
| `GetRiderApplicationStatus` | In review / needs a fix (which document, why) / approved. |
| `ResubmitRiderDocument` | Re-upload the document the reviewer asked about. |
| `ListRiders` | Admin. |
| `GetRider` | One rider (admin). |
| `ListRiderApplications` | Rider applications review queue. |
| `ReviewRiderDocument` | Approves or rejects one rider document. |
| `DecideRiderApplication` | Approve only when every document is approved (reason DOCUMENTS_NOT_APPROVED). |
| `SetRiderZones` | Zones the rider works in (at least one). |
| `SetRiderSuspended` | Suspends/unsuspends a rider with a reason. |

**`kade.location.v1.LocationService`**

| RPC | What it does |
| --- | --- |
| `StreamRiderLocations` (client stream) | Gateway-rider forwards each rider's socket positions on one long-lived client stream. |
| `ReportRiderLocations` | Unary fallback for a batch of positions (e.g. |
| `GetLastKnownLocation` | Latest position of one rider. |
| `BatchGetLastKnownLocations` | Latest positions of many riders or everyone in a box. |

**`kade.ledger.v1.LedgerService`**

| RPC | What it does |
| --- | --- |
| `GetAccount` | One ledger account and balance. |
| `ListAccounts` | Accounts of a type (e.g. every RESTAURANT_PAYABLE). |
| `ListJournalEntries` | Entries by account, reference or time range. |
| `PostAdjustment` | Finance-only manual adjustment; must balance (INVALID_ARGUMENT reason ENTRY_UNBALANCED). |
| `GetOrderLedger` | Every entry touching an order, for the admin order page and reconciliation. |
| `ListRefunds` | Admin finance refunds ledger (from OrderRefunded). |

**`kade.ledger.v1.RestaurantFinanceService`**

| RPC | What it does |
| --- | --- |
| `GetOutletSales` | Daily orders, card, cash and offer cost for a date range. |
| `ListOutletStatements` | The current week (still adding up) and earlier ones, newest first. |
| `GetOutletStatement` | One weekly statement with its days. |
| `ExportOutletStatementCsv` | One row per day, then the totals. |

**`kade.ledger.v1.PayoutService`**

| RPC | What it does |
| --- | --- |
| `ListPayoutBatches` | Weekly restaurant payout batches. |
| `GetPayoutBatch` | One batch with a line per outlet. |
| `ApprovePayoutBatch` | DRAFT → APPROVED (reason BATCH_NOT_DRAFT otherwise). |
| `MarkPayoutBatchPaid` | APPROVED → PAID once the bank file is confirmed; emits PayoutCompleted per outlet. |

**`kade.ledger.v1.RiderFinanceService`**

| RPC | What it does |
| --- | --- |
| `GetRiderEarnings` | Earnings for today/week/month with bars and comparison. |
| `GetRiderCashBalance` | Cash collected, owed to the rider, holding and limit. |
| `ListRiderPayouts` | Weekly payouts with cash offsets. |
| `ListDepositPoints` | Where riders can deposit cash. |
| `ListRiderSettlements` | Weekly rider settlements (earnings vs cash held). |
| `SettleRider` | Nets earnings against cash held for the week and closes it. |
| `ListCashRecords` | Daily cash collected per rider vs deposits. |
| `RecordCashDeposit` | Matches a bank deposit slip against a rider's cash (bank_ref required). |

**`kade.notification.v1.NotificationService`**

| RPC | What it does |
| --- | --- |
| `SendNotification` | Queues one message. |
| `GetNotification` | One notification and its delivery status. |
| `ListNotifications` | Delivery log for one recipient (ops/support). |
| `RegisterPushDevice` | Stores a push token for a user/device. |
| `UnregisterPushDevice` | Removes a push token (sign-out). |

**`kade.review.v1.ReviewService`**

| RPC | What it does |
| --- | --- |
| `SubmitOrderRating` | One per order, by its customer, after DELIVERED/COLLECTED (reason ORDER_NOT_RATEABLE); a second call replaces the first within 7 days. |
| `BatchGetOrderRatings` | Ratings for several orders (history and order screens). |
| `ListRestaurantReviews` | Customer restaurant page and restaurant app reviews tab. |
| `ReplyToReview` | Posts or replaces the outlet's reply; empty text removes it. |
| `GetRestaurantRatingSummary` | Average, count and star breakdown. |
| `GetDishRatings` | Share of thumbs-up per dish (menu "liked by 92%"). |
| `GetRiderRatingsSummary` | Rider app ratings screen. |
| `SubmitTripFeedback` | The rider's thumbs on the customer and the restaurant after a trip. |

**`kade.support.v1.SupportService`**

| RPC | What it does |
| --- | --- |
| `PreviewOrderIssue` | What would be paid back for a problem, shown before sending. |
| `ReportOrderIssue` | Reports a problem with an order, opens a ticket and applies the resolution (CREDIT/CARD refund via order.RefundOrder; REVIEW waits for an agent). |
| `BatchGetOrderIssues` | Issues for orders (order history and order detail screens). |
| `GetOrStartConversation` | Returns the requester's open chat, creating one with a greeting if none. |
| `SendMessage` | Agent replies arrive over realtime (ticket:<id>) as TicketMessageAdded. |
| `ListMessages` | Messages in a conversation. |
| `ListHelpTopics` | Help articles for customers, riders or restaurants. |

**`kade.support.v1.TicketAdminService`**

| RPC | What it does |
| --- | --- |
| `ListTickets` | Support queue with filters (status, category, priority, assignee, SLA). |
| `GetTicket` | One ticket with messages. |
| `ReplyToTicket` | Agent reply (first reply stops the SLA clock). |
| `AssignTicket` | Empty assignee unassigns. |
| `SetTicketPriority` | Recomputes sla_due_at from opened_at. |
| `ResolveTicket` | Refund (order.RefundOrder), credit (profile.ChangeCredit, customers only) or none. |
| `ReopenTicket` | Reopens a resolved ticket. |
| `ListMacros` | Canned replies. |
