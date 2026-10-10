# Kadé page plan

Four products share one order. Every page is designed with the design system in `DESIGN.md`.

```
placed → accepted by restaurant → preparing → ready → picked up → delivered
   └→ rejected / cancelled / refunded (can branch off at any stage)
```

**Payments:** card, and cash on delivery. Cash on delivery means riders track the cash they're holding, and finance matches it against what's owed.

**Turmeric surface per product:**

- Customer: search band (home), "Add to order" (item options), "Place order" (checkout), status band (tracking and delivered)
- Restaurant: new-order alert
- Rider: "Go online" button and new-job card
- Admin: none

## Build order

### Phase 1: core customer flow

- [x] Home feed: `/`
- [x] Restaurant page (`/restaurant/:id`): menu sections with sticky menu bar, info, popular items, reviews
- [x] Item options: size, spice level, add-ons, notes, quantity
- [x] Cart (`/cart` on phones, drawer on wider screens) with "people also added"
- [x] Checkout (`/checkout`): delivery or pickup, now or scheduled, card or cash on delivery, promo code, tip
- [x] Live tracking (`/orders/:id`): map, status steps, call or chat with the rider, cancel window
- [x] Delivered + rating (`/orders/:id` once delivered): food and rider rating, tip, receipt

### Phase 2: rest of the customer side

- [x] Sign in / sign up: phone number + SMS code, Google, Apple
- [x] Address picker: map pin, saved addresses, notes for the rider
- [x] Search results: dishes and restaurants tabs, recent searches
- [x] Category / collection page
- [x] Orders history + receipt + reorder
- [x] Help with an order: missing or wrong item → refund or credit
- [x] Account: profile, addresses, payment methods, favourites, notifications, language
- [x] Support chat
- [x] Empty and error screens: outside the delivery area, restaurant closed, payment failed, no internet

### Phase 3: restaurant app (tablet)

- [x] Live orders board: new orders with sound and countdown to accept, set prep time, preparing, ready, picked up
- [x] Order ticket: print for the kitchen
- [x] Menu manager: sections, items, options, photos, sold-out switch
- [x] Hours and busy mode
- [x] Promotions
- [x] Sales and payouts: commission, statements
- [x] Reviews and replies
- [x] Partner sign-up: documents, bank account, menu upload
- [x] Staff and settings

### Phase 4: rider app (phone)

- [x] Go online: big button, map of busy areas
- [x] New job: pickup and drop-off, distance, earnings, countdown to accept
- [x] Pickup: directions, "I've arrived", check items
- [x] Drop-off: directions, contact customer, proof of delivery, collect cash
- [x] Earnings: today and this week, bonuses, cash you're holding, payouts
- [x] Sign-up: licence, vehicle (motorbike, tuk-tuk, bicycle), documents, approval
- [x] Past trips, ratings, support

### Phase 5: admin console (desktop)

- [x] Live dashboard: map of orders and riders, key numbers
- [x] Orders: search, assign another rider, refund, cancel
- [x] Finance: restaurant payouts, rider settlements, cash matching
- [x] Restaurants: approve, commission, suspend
- [x] Riders: approve, documents, zones, suspend
- [x] Customers: refunds, fraud flags
- [x] Zones and pricing: delivery areas, fees, busy-time surcharges
- [x] Promotions and vouchers
- [x] Support tickets
- [x] Home feed content: categories, banners, collections
- [x] Team roles and audit log

### Phase 6: extras

- [x] Landing page (logged out)
- [x] Group order
- [x] Grocery / shop page
- [x] Kadé Plus
- [x] Gift cards + refer a friend
