import { status } from "@grpc/grpc-js";
import { Thumb, type SubmitOrderRatingRequest } from "@kade/proto/kade/review/v1/review_service";
import { describe, expect, it } from "vitest";
import { DomainError } from "../platform/grpc/errors.js";
import { toReview, validateRating } from "./reviews.grpc.js";

const base: SubmitOrderRatingRequest = {
  orderId: "o1",
  customerId: "c1",
  riderStars: 0,
  riderTags: [],
  dishes: [],
  restaurantStars: 0,
  comment: "",
  idempotencyKey: "",
};

function reason(fn: () => unknown): [status, string] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    return [(e as DomainError).code, (e as DomainError).reason];
  }
  throw new Error("expected a DomainError");
}

describe("validateRating", () => {
  it("trims, dedupes and accepts a normal rating", () => {
    const v = validateRating({
      ...base,
      riderStars: 5,
      riderTags: [" Friendly ", "Friendly", ""],
      dishes: [
        { itemId: "i1", itemName: "Cheese kottu", thumb: Thumb.THUMB_UP },
        { itemId: "i1", itemName: "Cheese kottu", thumb: Thumb.THUMB_DOWN },
      ],
      comment: "  Hot and fast ",
    });
    expect(v).toMatchObject({ riderStars: 5, riderTags: ["Friendly"], comment: "Hot and fast" });
    expect(v.dishes).toHaveLength(1);
  });

  it.each([
    [{ riderStars: 6 }, "RATING_STARS_INVALID"],
    [{ restaurantStars: -1 }, "RATING_STARS_INVALID"],
    [{}, "RATING_EMPTY"],
    [{ comment: "x".repeat(1001) }, "COMMENT_TOO_LONG"],
    [{ riderStars: 4, riderTags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, "RIDER_TAGS_INVALID"],
    [{ dishes: [{ itemId: "i", itemName: "", thumb: Thumb.THUMB_UNSPECIFIED }] }, "THUMB_INVALID"],
  ])("rejects %o with %s", (patch, expected) => {
    expect(reason(() => validateRating({ ...base, ...patch }))).toEqual([status.INVALID_ARGUMENT, expected]);
  });
});

describe("toReview", () => {
  it("only includes a reply when there is one", () => {
    const row = {
      id: "r",
      orderId: null,
      restaurantId: "x",
      customerName: "Shehani",
      dish: "Cheese kottu",
      stars: 5,
      text: "Hot",
      createdAt: new Date(0),
      replyText: null,
      replyAt: null,
      replyBy: null,
    };
    expect(toReview(row).reply).toBeUndefined();
    expect(toReview({ ...row, replyText: "Thanks", replyAt: new Date(1), replyBy: "Ruwan" }).reply).toEqual({
      text: "Thanks",
      at: new Date(1),
      by: "Ruwan",
    });
  });
});
