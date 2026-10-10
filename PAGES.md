# Kadé page plan

Four products share one order. Every page is designed with the design system in `DESIGN.md`.

```
placed → accepted by restaurant → preparing → ready → picked up → delivered
   └→ rejected / cancelled / refunded (can branch off at any stage)
```

**Payments:** card, and cash on delivery. Cash on delivery means riders track the cash they're holding, and finance matches it against what's owed.

**Turmeric surface per product:**
- Customer: search band (home), "Add to order" button (restaurant item options)
- Restaurant: new-order alert
- Rider: "Go online" button and new-job card
- Admin: none

## Build order

### Phase 1: core customer flow
- [x] Home feed: `index.html`
- [x] Restaurant page (`restaurant.html?id=1`): menu sections with sticky menu bar, info, popular items, reviews
- [x] Item options: size, spice level, add-ons, notes, quantity
- [ ] Cart (full page on mobile, drawer on desktop) with "people also added"
- [ ] Checkout: delivery or pickup, now or scheduled, card or cash on delivery, promo code, tip
- [ ] Live tracking: map, status steps, call or chat with the rider, cancel window
- [ ] Delivered + rating: food and rider rating, tip, receipt

### Phase 2: rest of the customer side
- [ ] Sign in / sign up: phone number + SMS code, Google, Apple
- [ ] Address picker: map pin, saved addresses, notes for the rider
- [ ] Search results: dishes and restaurants tabs, recent searches
- [ ] Category / collection page
- [ ] Orders history + receipt + reorder
- [ ] Help with an order: missing or wrong item → refund or credit
- [ ] Account: profile, addresses, payment methods, favourites, notifications, language
- [ ] Support chat
- [ ] Empty and error screens: outside the delivery area, restaurant closed, payment failed, no internet

### Phase 3: restaurant app (tablet)
- [ ] Live orders board: new orders with sound and countdown to accept, set prep time, preparing, ready, picked up
- [ ] Order ticket: print for the kitchen
- [ ] Menu manager: sections, items, options, photos, sold-out switch
- [ ] Hours and busy mode
- [ ] Promotions
- [ ] Sales and payouts: commission, statements
- [ ] Reviews and replies
- [ ] Partner sign-up: documents, bank account, menu upload
- [ ] Staff and settings

### Phase 4: rider app (phone)
- [ ] Go online: big button, map of busy areas
- [ ] New job: pickup and drop-off, distance, earnings, countdown to accept
- [ ] Pickup: directions, "I've arrived", check items
- [ ] Drop-off: directions, contact customer, proof of delivery, collect cash
- [ ] Earnings: today and this week, bonuses, cash you're holding, payouts
- [ ] Sign-up: licence, vehicle (motorbike, tuk-tuk, bicycle), documents, approval
- [ ] Past trips, ratings, support

### Phase 5: admin console (desktop)
- [ ] Live dashboard: map of orders and riders, key numbers
- [ ] Orders: search, assign another rider, refund, cancel
- [ ] Finance: restaurant payouts, rider settlements, cash matching
- [ ] Restaurants: approve, commission, suspend
- [ ] Riders: approve, documents, zones, suspend
- [ ] Customers: refunds, fraud flags
- [ ] Zones and pricing: delivery areas, fees, busy-time surcharges
- [ ] Promotions and vouchers
- [ ] Support tickets
- [ ] Home feed content: categories, banners, collections
- [ ] Team roles and audit log

### Phase 6: extras
- [ ] Landing page (logged out)
- [ ] Group order
- [ ] Grocery / shop page
- [ ] Kadé Plus
- [ ] Gift cards + refer a friend
