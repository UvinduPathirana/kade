import { Injectable } from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  dishRatings,
  orderRatings,
  rateableOrders,
  ratingBaselines,
  reviews,
  tripFeedback,
} from "../db/schema.js";
import type { Queryable, Tx } from "../platform/db/database.js";
import type { Baseline } from "./ratings.js";

export type RateableOrderRow = typeof rateableOrders.$inferSelect;
export type OrderRatingRow = typeof orderRatings.$inferSelect;
export type NewOrderRating = typeof orderRatings.$inferInsert;
export type DishRatingRow = typeof dishRatings.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;

export interface ReviewFilter {
  restaurantId: string;
  withTextOnly: boolean;
  unrepliedOnly: boolean;
  maxStars: number;
}

@Injectable()
export class ReviewsRepository {
  // ---------- rateable orders ----------

  async upsertRateable(tx: Queryable, row: typeof rateableOrders.$inferInsert): Promise<void> {
    await tx
      .insert(rateableOrders)
      .values(row)
      .onConflictDoUpdate({ target: rateableOrders.orderId, set: row });
  }

  async findRateable(db: Queryable, orderId: string): Promise<RateableOrderRow | undefined> {
    const [row] = await db.select().from(rateableOrders).where(eq(rateableOrders.orderId, orderId));
    return row;
  }

  // ---------- order ratings ----------

  /** Locks the existing rating so two submissions for one order serialise. */
  async findRatingForUpdate(tx: Tx, orderId: string): Promise<OrderRatingRow | undefined> {
    const [row] = await tx.select().from(orderRatings).where(eq(orderRatings.orderId, orderId)).for("update");
    return row;
  }

  async saveRating(tx: Tx, row: NewOrderRating, dishes: (typeof dishRatings.$inferInsert)[]) {
    await tx.insert(orderRatings).values(row).onConflictDoUpdate({ target: orderRatings.orderId, set: row });
    await tx.delete(dishRatings).where(eq(dishRatings.orderId, row.orderId));
    if (dishes.length > 0) await tx.insert(dishRatings).values(dishes);
  }

  async ratings(
    db: Queryable,
    orderIds: string[],
  ): Promise<{ rating: OrderRatingRow; dishes: DishRatingRow[] }[]> {
    if (orderIds.length === 0) return [];
    const rows = await db.select().from(orderRatings).where(inArray(orderRatings.orderId, orderIds));
    const dishes = rows.length
      ? await db
          .select()
          .from(dishRatings)
          .where(
            inArray(
              dishRatings.orderId,
              rows.map((r) => r.orderId),
            ),
          )
      : [];
    return rows.map((rating) => ({ rating, dishes: dishes.filter((d) => d.orderId === rating.orderId) }));
  }

  // ---------- reviews ----------

  async upsertReviewForOrder(tx: Tx, review: NewReview): Promise<ReviewRow> {
    const [row] = await tx
      .insert(reviews)
      .values(review)
      .onConflictDoUpdate({
        target: reviews.orderId,
        set: { stars: review.stars, text: review.text, dish: review.dish, customerName: review.customerName },
      })
      .returning();
    return row!;
  }

  async deleteReviewForOrder(tx: Tx, orderId: string): Promise<void> {
    await tx.delete(reviews).where(eq(reviews.orderId, orderId));
  }

  async findReview(db: Queryable, id: string): Promise<ReviewRow | undefined> {
    const [row] = await db.select().from(reviews).where(eq(reviews.id, id));
    return row;
  }

  async findReviewByOrder(db: Queryable, orderId: string): Promise<ReviewRow | undefined> {
    const [row] = await db.select().from(reviews).where(eq(reviews.orderId, orderId));
    return row;
  }

  async setReply(
    tx: Tx,
    id: string,
    reply: { text: string; at: Date; by: string } | undefined,
  ): Promise<ReviewRow> {
    const [row] = await tx
      .update(reviews)
      .set({ replyText: reply?.text ?? null, replyAt: reply?.at ?? null, replyBy: reply?.by ?? null })
      .where(eq(reviews.id, id))
      .returning();
    return row!;
  }

  async listReviews(db: Queryable, filter: ReviewFilter, offset: number, limit: number) {
    const where = and(
      eq(reviews.restaurantId, filter.restaurantId),
      filter.withTextOnly ? sql`length(trim(${reviews.text})) > 0` : undefined,
      filter.unrepliedOnly ? isNull(reviews.replyText) : undefined,
      filter.maxStars > 0 ? lte(reviews.stars, filter.maxStars) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(reviews)
        .where(where)
        .orderBy(desc(reviews.createdAt), desc(reviews.id))
        .offset(offset)
        .limit(limit),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(reviews)
        .where(where),
    ]);
    return { rows, total: total?.n ?? 0 };
  }

  // ---------- aggregates ----------

  async baseline(db: Queryable, kind: "restaurant" | "rider", id: string): Promise<Baseline | undefined> {
    const [row] = await db
      .select()
      .from(ratingBaselines)
      .where(and(eq(ratingBaselines.subjectKind, kind), eq(ratingBaselines.subjectId, id)));
    return row;
  }

  async restaurantStars(db: Queryable, restaurantId: string): Promise<number[]> {
    const rows = await db
      .select({ stars: orderRatings.restaurantStars })
      .from(orderRatings)
      .where(and(eq(orderRatings.restaurantId, restaurantId), gt(orderRatings.restaurantStars, 0)));
    return rows.map((r) => r.stars);
  }

  async riderTotals(db: Queryable, riderId: string): Promise<{ count: number; sum: number }> {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${orderRatings.riderStars}), 0)::int`,
      })
      .from(orderRatings)
      .where(and(eq(orderRatings.riderId, riderId), gt(orderRatings.riderStars, 0)));
    return { count: row?.count ?? 0, sum: row?.sum ?? 0 };
  }

  /** Latest rider ratings, newest first. */
  async recentRiderRatings(db: Queryable, riderId: string, limit: number): Promise<OrderRatingRow[]> {
    return db
      .select()
      .from(orderRatings)
      .where(and(eq(orderRatings.riderId, riderId), gt(orderRatings.riderStars, 0)))
      .orderBy(desc(orderRatings.ratedAt))
      .limit(limit);
  }

  async allRiderTags(db: Queryable, riderId: string): Promise<string[][]> {
    const rows = await db
      .select({ tags: orderRatings.riderTags })
      .from(orderRatings)
      .where(and(eq(orderRatings.riderId, riderId), sql`cardinality(${orderRatings.riderTags}) > 0`));
    return rows.map((r) => r.tags);
  }

  async dishScores(db: Queryable, restaurantId: string) {
    return db
      .select({
        itemId: dishRatings.itemId,
        up: sql<number>`count(*) filter (where ${dishRatings.thumb} = 1)::int`,
        down: sql<number>`count(*) filter (where ${dishRatings.thumb} = 2)::int`,
      })
      .from(dishRatings)
      .where(eq(dishRatings.restaurantId, restaurantId))
      .groupBy(dishRatings.itemId)
      .orderBy(dishRatings.itemId);
  }

  // ---------- trip feedback ----------

  async saveTripFeedback(tx: Tx, row: typeof tripFeedback.$inferInsert): Promise<void> {
    await tx
      .insert(tripFeedback)
      .values(row)
      .onConflictDoUpdate({ target: tripFeedback.deliveryId, set: row });
  }
}
