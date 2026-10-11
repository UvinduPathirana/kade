import { Inject, Injectable } from "@nestjs/common";
import {
  OrderRated,
  RestaurantRatingChanged,
  ReviewReplied,
  RiderRatingChanged,
  TripFeedbackSubmitted,
} from "@kade/proto/kade/review/v1/review_events";
import {
  ReviewServiceService,
  SubmitOrderRatingRequest,
  SubmitOrderRatingResponse,
  Thumb,
  type BatchGetOrderRatingsRequest,
  type BatchGetOrderRatingsResponse,
  type GetDishRatingsRequest,
  type GetDishRatingsResponse,
  type GetRestaurantRatingSummaryRequest,
  type GetRestaurantRatingSummaryResponse,
  type GetRiderRatingsSummaryRequest,
  type GetRiderRatingsSummaryResponse,
  type ListRestaurantReviewsRequest,
  type ListRestaurantReviewsResponse,
  type OrderRating,
  type RatingSummary,
  type ReplyToReviewRequest,
  type ReplyToReviewResponse,
  type Review,
  type SubmitTripFeedbackRequest,
  type SubmitTripFeedbackResponse,
} from "@kade/proto/kade/review/v1/review_service";
import { v7 as uuidv7 } from "uuid";
import { Database, type Queryable, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound, permissionDenied } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";
import { rateableFromOrder } from "./order-events.consumer.js";
import { OrderLookup } from "./order-lookup.js";
import {
  compliments,
  improvementTips,
  MAX_COMMENT,
  MAX_REPLY,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  publicName,
  RECENT_WINDOW,
  REPLACE_WINDOW_MS,
  restaurantSummary,
  riderSummary,
} from "./ratings.js";
import {
  ReviewsRepository,
  type DishRatingRow,
  type NewOrderRating,
  type OrderRatingRow,
  type RateableOrderRow,
  type ReviewRow,
} from "./reviews.repository.js";

const STAFF = ["ops", "support", "admin"];
const MERCHANT = ["merchant_staff", "merchant_owner"];
const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;
const MAX_BATCH = 100;
const RECENT_SHOWN = 10;
const T = "kade.review.v1.";

/**
 * kade.review.v1.ReviewService. Ratings, public reviews with one outlet reply, and the rolled-up
 * rating events (restaurant → catalog/search, rider → dispatch), all written through the outbox.
 */
@GrpcService(ReviewServiceService)
@Injectable()
export class ReviewGrpcService implements GrpcHandlers<ReviewServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ReviewsRepository) private readonly repo: ReviewsRepository,
    @Inject(OutboxWriter) private readonly outbox: OutboxWriter,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
    @Inject(OrderLookup) private readonly orders: OrderLookup,
  ) {}

  async submitOrderRating(
    request: SubmitOrderRatingRequest,
    ctx: RequestContext,
  ): Promise<SubmitOrderRatingResponse> {
    const customerId = request.customerId || ctx.userId;
    if (!customerId)
      throw invalidArgument("CUSTOMER_REQUIRED", "Sign in to rate an order.", { field: "customer_id" });
    if (ctx.userId && ctx.userId !== customerId && !isStaff(ctx)) {
      throw permissionDenied("NOT_YOUR_ORDER", "You can only rate your own orders.");
    }
    if (!request.orderId)
      throw invalidArgument("ORDER_REQUIRED", "Say which order you're rating.", { field: "order_id" });
    const input = validateRating(request);

    const order = await this.rateableOrder(request.orderId);
    if (!order) {
      throw failedPrecondition("ORDER_NOT_RATEABLE", "You can rate this order once it has arrived.", {
        order_id: request.orderId,
      });
    }
    if (order.customerId !== customerId)
      throw permissionDenied("NOT_YOUR_ORDER", "You can only rate your own orders.");
    if (input.riderStars > 0 && !order.riderId) {
      throw invalidArgument("RIDER_NOT_RATEABLE", "This order had no rider to rate.", {
        field: "rider_stars",
      });
    }
    if (order.dishes.length > 0) {
      const known = new Set(order.dishes.map((d) => d.itemId));
      const stranger = input.dishes.find((d) => !known.has(d.itemId));
      if (stranger) {
        throw invalidArgument("DISH_NOT_IN_ORDER", "You can only rate dishes from this order.", {
          item_id: stranger.itemId,
        });
      }
    }

    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `SubmitOrderRating:${customerId}`,
          key: request.idempotencyKey,
          request: SubmitOrderRatingRequest.encode(request).finish(),
          codec: SubmitOrderRatingResponse,
        },
        async () => {
          const now = new Date();
          const previous = await this.repo.findRatingForUpdate(tx, order.orderId);
          if (previous && now.getTime() - previous.firstRatedAt.getTime() > REPLACE_WINDOW_MS) {
            throw failedPrecondition(
              "RATING_LOCKED",
              "Ratings can be changed for 7 days after you send them.",
            );
          }
          const names = new Map(order.dishes.map((d) => [d.itemId, d.name]));
          const rating: NewOrderRating = {
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            customerId,
            restaurantId: order.restaurantId,
            riderId: order.riderId,
            riderStars: input.riderStars,
            riderTags: input.riderStars > 0 || input.riderTags.length > 0 ? input.riderTags : [],
            restaurantStars: input.restaurantStars,
            comment: input.comment,
            area: order.area,
            firstRatedAt: previous?.firstRatedAt ?? now,
            ratedAt: now,
          };
          const dishes = input.dishes.map((d) => ({
            orderId: order.orderId,
            itemId: d.itemId,
            itemName: d.itemName || names.get(d.itemId) || "",
            restaurantId: order.restaurantId,
            thumb: d.thumb,
          }));
          await this.repo.saveRating(tx, rating, dishes);

          let review: ReviewRow | undefined;
          if (input.restaurantStars > 0) {
            review = await this.repo.upsertReviewForOrder(tx, {
              id: uuidv7(),
              orderId: order.orderId,
              restaurantId: order.restaurantId,
              customerName: publicName(order.customerName),
              dish: dishes[0]?.itemName ?? "",
              stars: input.restaurantStars,
              text: input.comment,
              createdAt: now,
            });
          } else if (previous && previous.restaurantStars > 0) {
            await this.repo.deleteReviewForOrder(tx, order.orderId);
          }

          const saved = toOrderRating(
            { ...rating, riderTags: rating.riderTags ?? [] } as OrderRatingRow,
            dishes,
          );
          await this.outbox.append(tx, {
            aggregateType: "review",
            aggregateId: order.orderId,
            type: `${T}OrderRated`,
            payload: OrderRated.encode({
              orderId: order.orderId,
              rating: saved,
              reviewId: review?.id ?? "",
              occurredAt: now,
            }).finish(),
          });
          if (input.restaurantStars > 0 || (previous?.restaurantStars ?? 0) > 0) {
            await this.outbox.append(tx, {
              aggregateType: "review",
              aggregateId: order.restaurantId,
              type: `${T}RestaurantRatingChanged`,
              payload: RestaurantRatingChanged.encode({
                restaurantId: order.restaurantId,
                summary: await this.restaurantSummary(tx, order.restaurantId),
                occurredAt: now,
              }).finish(),
            });
          }
          if (order.riderId && (input.riderStars > 0 || (previous?.riderStars ?? 0) > 0)) {
            await this.outbox.append(tx, {
              aggregateType: "review",
              aggregateId: order.riderId,
              type: `${T}RiderRatingChanged`,
              payload: RiderRatingChanged.encode({
                riderId: order.riderId,
                summary: await this.riderSummary(tx, order.riderId),
                occurredAt: now,
              }).finish(),
            });
          }
          return { rating: saved };
        },
      ),
    );
  }

  async batchGetOrderRatings(request: BatchGetOrderRatingsRequest): Promise<BatchGetOrderRatingsResponse> {
    if (request.orderIds.length > MAX_BATCH) {
      throw invalidArgument("TOO_MANY_IDS", `Ask for at most ${MAX_BATCH} orders at a time.`, {
        field: "order_ids",
      });
    }
    const found = await this.repo.ratings(this.database.db, [...new Set(request.orderIds)]);
    return { ratings: found.map(({ rating, dishes }) => toOrderRating(rating, dishes)) };
  }

  async listRestaurantReviews(request: ListRestaurantReviewsRequest): Promise<ListRestaurantReviewsResponse> {
    if (!request.restaurantId) {
      throw invalidArgument("RESTAURANT_REQUIRED", "Say which restaurant.", { field: "restaurant_id" });
    }
    const offset = parseOffset(request.page?.pageToken);
    const limit = Math.min(Math.max(request.page?.pageSize || DEFAULT_PAGE, 1), MAX_PAGE);
    const { rows, total } = await this.repo.listReviews(
      this.database.db,
      {
        restaurantId: request.restaurantId,
        withTextOnly: request.withTextOnly,
        unrepliedOnly: request.unrepliedOnly,
        maxStars: request.maxStars,
      },
      offset,
      limit,
    );
    return {
      reviews: rows.map(toReview),
      page: {
        nextPageToken: offset + rows.length < total ? String(offset + rows.length) : "",
        totalSize: total,
      },
    };
  }

  async replyToReview(request: ReplyToReviewRequest, ctx: RequestContext): Promise<ReplyToReviewResponse> {
    if (!isStaff(ctx) && !MERCHANT.some((r) => ctx.hasRole(r))) {
      throw permissionDenied("PERMISSION_DENIED", "Only the restaurant can reply to its reviews.");
    }
    const text = request.text.trim();
    if (text.length > MAX_REPLY) {
      throw invalidArgument("REPLY_TOO_LONG", `Keep replies under ${MAX_REPLY} characters.`, {
        field: "text",
      });
    }
    const outletId = ctx.outletId || request.outletId;
    return this.database.transaction(ctx, async (tx) => {
      const existing = await this.repo.findReview(tx, request.reviewId);
      if (!existing) throw notFound("REVIEW_NOT_FOUND", "This review has been removed.");
      if (!isStaff(ctx) && existing.restaurantId !== outletId) {
        throw permissionDenied("REVIEW_NOT_YOURS", "This review belongs to another restaurant.");
      }
      const now = new Date();
      const row = await this.repo.setReply(
        tx,
        existing.id,
        text ? { text, at: now, by: request.by || ctx.userId || "" } : undefined,
      );
      const review = toReview(row);
      await this.outbox.append(tx, {
        aggregateType: "review",
        aggregateId: row.orderId ?? row.id,
        type: `${T}ReviewReplied`,
        payload: ReviewReplied.encode({
          reviewId: row.id,
          restaurantId: row.restaurantId,
          orderId: row.orderId ?? "",
          reply: review.reply,
          occurredAt: now,
        }).finish(),
      });
      return { review };
    });
  }

  async getRestaurantRatingSummary(
    request: GetRestaurantRatingSummaryRequest,
  ): Promise<GetRestaurantRatingSummaryResponse> {
    if (!request.restaurantId) {
      throw invalidArgument("RESTAURANT_REQUIRED", "Say which restaurant.", { field: "restaurant_id" });
    }
    return { summary: await this.restaurantSummary(this.database.db, request.restaurantId) };
  }

  async getDishRatings(request: GetDishRatingsRequest): Promise<GetDishRatingsResponse> {
    if (!request.restaurantId) {
      throw invalidArgument("RESTAURANT_REQUIRED", "Say which restaurant.", { field: "restaurant_id" });
    }
    return { dishes: await this.repo.dishScores(this.database.db, request.restaurantId) };
  }

  async getRiderRatingsSummary(
    request: GetRiderRatingsSummaryRequest,
  ): Promise<GetRiderRatingsSummaryResponse> {
    if (!request.riderId) throw invalidArgument("RIDER_REQUIRED", "Say which rider.", { field: "rider_id" });
    const db = this.database.db;
    const [baseline, recent, allTags] = await Promise.all([
      this.repo.baseline(db, "rider", request.riderId),
      this.repo.recentRiderRatings(db, request.riderId, RECENT_WINDOW),
      this.repo.allRiderTags(db, request.riderId),
    ]);
    return {
      summary: await this.riderSummary(db, request.riderId),
      compliments: compliments(baseline, allTags),
      improve: improvementTips(
        baseline,
        recent.map((r) => r.riderTags),
      ),
      recent: recent.slice(0, RECENT_SHOWN).map((r) => ({
        id: r.orderId,
        stars: r.riderStars,
        comment: r.comment,
        at: r.ratedAt,
        area: r.area,
      })),
    };
  }

  async submitTripFeedback(
    request: SubmitTripFeedbackRequest,
    ctx: RequestContext,
  ): Promise<SubmitTripFeedbackResponse> {
    const riderId = request.riderId;
    if (!riderId) throw invalidArgument("RIDER_REQUIRED", "Say which rider.", { field: "rider_id" });
    if (!request.deliveryId)
      throw invalidArgument("DELIVERY_REQUIRED", "Say which trip.", { field: "delivery_id" });
    const thumbs = [request.customer, request.restaurant];
    if (thumbs.some((t) => t !== Thumb.THUMB_UNSPECIFIED && t !== Thumb.THUMB_UP && t !== Thumb.THUMB_DOWN)) {
      throw invalidArgument("THUMB_INVALID", "Thumbs are up or down.", { field: "customer" });
    }
    if (thumbs.every((t) => t === Thumb.THUMB_UNSPECIFIED)) {
      throw invalidArgument("RATING_EMPTY", "Give the customer or the restaurant a thumb first.");
    }
    await this.database.transaction(ctx, async (tx) => {
      const now = new Date();
      await this.repo.saveTripFeedback(tx, {
        deliveryId: request.deliveryId,
        orderId: request.orderId,
        riderId,
        customer: request.customer,
        restaurant: request.restaurant,
        submittedAt: now,
      });
      await this.outbox.append(tx, {
        aggregateType: "review",
        aggregateId: request.orderId || request.deliveryId,
        type: `${T}TripFeedbackSubmitted`,
        payload: TripFeedbackSubmitted.encode({ ...request, occurredAt: now }).finish(),
      });
    });
    return {};
  }

  /** The order if it may be rated: from our projection, else (once) from the order service. */
  private async rateableOrder(orderId: string): Promise<RateableOrderRow | undefined> {
    const known = await this.repo.findRateable(this.database.db, orderId);
    if (known) return known;
    const order = await this.orders.completedOrder(orderId);
    if (!order) return undefined;
    const row = rateableFromOrder(order);
    await this.repo.upsertRateable(this.database.db, row);
    return this.repo.findRateable(this.database.db, orderId);
  }

  private async restaurantSummary(db: Queryable | Tx, restaurantId: string): Promise<RatingSummary> {
    const [baseline, stars] = await Promise.all([
      this.repo.baseline(db, "restaurant", restaurantId),
      this.repo.restaurantStars(db, restaurantId),
    ]);
    return restaurantSummary(baseline, stars);
  }

  private async riderSummary(db: Queryable | Tx, riderId: string): Promise<RatingSummary> {
    const [baseline, totals, recent] = await Promise.all([
      this.repo.baseline(db, "rider", riderId),
      this.repo.riderTotals(db, riderId),
      this.repo.recentRiderRatings(db, riderId, RECENT_WINDOW),
    ]);
    return riderSummary(
      baseline,
      totals.count,
      totals.sum,
      recent.map((r) => r.riderStars),
    );
  }
}

export function validateRating(request: SubmitOrderRatingRequest) {
  const stars = (n: number, field: string) => {
    if (!Number.isInteger(n) || n < 0 || n > 5) {
      throw invalidArgument("RATING_STARS_INVALID", "Stars go from 1 to 5.", { field });
    }
    return n;
  };
  const riderStars = stars(request.riderStars, "rider_stars");
  const restaurantStars = stars(request.restaurantStars, "restaurant_stars");
  const comment = request.comment.trim();
  if (comment.length > MAX_COMMENT) {
    throw invalidArgument("COMMENT_TOO_LONG", `Keep it under ${MAX_COMMENT} characters.`, {
      field: "comment",
    });
  }
  const riderTags = [...new Set(request.riderTags.map((t) => t.trim()).filter(Boolean))];
  if (riderTags.length > MAX_TAGS || riderTags.some((t) => t.length > MAX_TAG_LENGTH)) {
    throw invalidArgument("RIDER_TAGS_INVALID", "Pick up to 10 short tags.", { field: "rider_tags" });
  }
  const seen = new Set<string>();
  const dishes = request.dishes.filter((d) => {
    if (!d.itemId || seen.has(d.itemId)) return false;
    if (d.thumb !== Thumb.THUMB_UP && d.thumb !== Thumb.THUMB_DOWN) {
      throw invalidArgument("THUMB_INVALID", "Dishes get a thumbs up or down.", { field: "dishes" });
    }
    seen.add(d.itemId);
    return true;
  });
  if (!riderStars && !restaurantStars && dishes.length === 0 && !comment && riderTags.length === 0) {
    throw invalidArgument("RATING_EMPTY", "Rate the food or the rider before sending.");
  }
  return { riderStars, restaurantStars, comment, riderTags, dishes };
}

export function toOrderRating(
  row: OrderRatingRow,
  dishes: Pick<DishRatingRow, "itemId" | "itemName" | "thumb">[],
): OrderRating {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerId: row.customerId,
    restaurantId: row.restaurantId,
    riderId: row.riderId ?? "",
    riderStars: row.riderStars ?? 0,
    riderTags: row.riderTags ?? [],
    dishes: dishes.map((d) => ({ itemId: d.itemId, itemName: d.itemName ?? "", thumb: d.thumb })),
    restaurantStars: row.restaurantStars ?? 0,
    comment: row.comment ?? "",
    ratedAt: row.ratedAt,
  };
}

export function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    orderId: row.orderId ?? "",
    restaurantId: row.restaurantId,
    customerName: row.customerName,
    dish: row.dish,
    stars: row.stars,
    text: row.text,
    createdAt: row.createdAt,
    reply: row.replyText
      ? { text: row.replyText, at: row.replyAt ?? undefined, by: row.replyBy ?? "" }
      : undefined,
  };
}

function isStaff(ctx: RequestContext): boolean {
  return STAFF.some((r) => ctx.hasRole(r));
}

function parseOffset(token: string | undefined): number {
  if (!token) return 0;
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", { field: "page.page_token" });
  }
  return n;
}
