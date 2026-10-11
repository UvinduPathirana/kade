# review

Owns ratings: the customer's rating of a delivered order (thumbs per dish, restaurant stars, rider
stars and tags, comment), public restaurant reviews with one editable outlet reply, rating summaries
for restaurants and riders, and riders' thumbs on customers and restaurants. Rolled-up ratings go out
as `RestaurantRatingChanged` (catalog/search) and `RiderRatingChanged` (dispatch) through the outbox.

Scaffolded from `services/_templates/ts`; see that README for the platform pieces.

- **Owns:** `rateable_orders`, `order_ratings`, `dish_ratings`, `reviews`, `rating_baselines`, `trip_feedback`
- **API:** `kade.review.v1.ReviewService`
- **Events out:** aggregate `review` → `kade.review.events`: `OrderRated`, `ReviewReplied` (key = order
  id), `RestaurantRatingChanged` (key = restaurant id), `RiderRatingChanged` (key = rider id),
  `TripFeedbackSubmitted`
- **Events in (group `review`):** `kade.order.events` `OrderDelivered` and `OrderCollected` open the order
  for rating and snapshot names, dishes and the drop-off area.
- **Calls:** `order.GetOrder` (`ORDER_GRPC`, 2 s deadline), only as a fallback when a customer rates
  before `OrderDelivered` has arrived.
- **Ports:** gRPC 50115, HTTP 8115. **Database:** `review` (login `review`).

## API

| RPC                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubmitOrderRating`          | Customer's own delivered/collected order. A second call replaces the first for 7 days. Idempotent on `idempotency_key`. Restaurant stars create or update the public review (name "Dilini P.", dish = first rated dish). Reasons: `ORDER_NOT_RATEABLE`, `NOT_YOUR_ORDER`, `RATING_LOCKED`, `RATING_EMPTY`, `RATING_STARS_INVALID`, `RIDER_NOT_RATEABLE`, `DISH_NOT_IN_ORDER`, `RIDER_TAGS_INVALID`, `COMMENT_TOO_LONG`, `THUMB_INVALID` |
| `BatchGetOrderRatings`       | Up to 100 orders (gateways join ratings onto orders)                                                                                                                                                                                                                                                                                                                                                                                    |
| `ListRestaurantReviews`      | Newest first; `with_text_only`, `unreplied_only`, `max_stars`; offset page token                                                                                                                                                                                                                                                                                                                                                        |
| `ReplyToReview`              | Merchant staff of the review's outlet (`x-outlet-id`) or ops/admin. Empty text removes the reply. `REVIEW_NOT_FOUND`, `REVIEW_NOT_YOURS`, `REPLY_TOO_LONG`                                                                                                                                                                                                                                                                              |
| `GetRestaurantRatingSummary` | Baseline plus live ratings; breakdown index 0 = 5 stars                                                                                                                                                                                                                                                                                                                                                                                 |
| `GetDishRatings`             | Thumbs up/down per item                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GetRiderRatingsSummary`     | Overall average; breakdown of the last 100; compliments; coaching tips from problem tags (`Late`, `Didn't call`, …); 10 most recent                                                                                                                                                                                                                                                                                                     |
| `SubmitTripFeedback`         | Rider's thumbs on the customer and restaurant, per delivery                                                                                                                                                                                                                                                                                                                                                                             |

**History baselines.** The apps advertise ratings like "4.8 · 3k+" and Nimal's 4.9 from 1,284
ratings. `rating_baselines` holds that history (count, star sum, breakdown, compliments), and every
summary is baseline + live ratings, so numbers start where the apps are and move with real ratings.

## Seed data (`SEED_DEMO_DATA=true`, idempotent)

Seed ids follow docs/backend/CONVENTIONS.md "Seeded ids".

- **Restaurant 1 (`…-8000-000000000001`, Galle Road Kottu House):** the restaurant app's 9 reviews,
  including the replies to Ravindu and Kavindi. The customer app's three (Shehani, Ravindu, Aisha) are
  among them.
- **Restaurants 2–16:** two or three reviews each.
- **Baselines** for all 16 restaurants (the customer app's rating and count).
- **Nimal (`…-8001-000000000101`):** the rider app's baseline, compliments and tips, plus the 4 recent
  ratings.

Review-private seed groups: `8a01` (reviews) and `8a02` (historical rated orders).

## Run alone

```sh
pnpm infra:up
cp services/review/.env.example services/review/.env
pnpm --filter @kade/review dev
deploy/compose/connect/register-outbox.sh review review    # once, after the first start
```

## Test

```sh
pnpm --filter @kade/review test               # unit: summaries, validation
pnpm --filter @kade/review test:integration   # shared stack: seed, rating flow, outbox → Debezium
```
