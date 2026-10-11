import { OrderStatus } from "@kade/proto/kade/order/v1/order_service";
import { describe, expect, it } from "vitest";
import { e164Phone, nationalPhone } from "./account.js";
import { ratingCountLabel, relativeDay } from "./catalog.js";
import { geoFromMap, mapFromGeo } from "./geo.js";
import { restaurantNumber, restaurantUuid } from "./ids.js";
import { toStatus } from "./orders.js";

describe("restaurant ids", () => {
  it("round-trips seeded ids through the app's numbers", () => {
    expect(restaurantNumber("00000000-0000-7000-8000-000000000001")).toBe(1);
    expect(restaurantNumber("00000000-0000-7000-8000-000000000016")).toBe(16);
    expect(restaurantUuid(16)).toBe("00000000-0000-7000-8000-000000000016");
  });

  it("gives non-seeded restaurants a stable hashed number it can map back", () => {
    const id = "0199d3a0-1234-7abc-8def-0123456789ab";
    const n = restaurantNumber(id);
    expect(n).toBeGreaterThanOrEqual(1_000_000);
    expect(restaurantNumber(id)).toBe(n);
    expect(restaurantUuid(n)).toBe(id);
    expect(restaurantUuid(1_999_999_999)).toBeUndefined();
    expect(restaurantUuid(0)).toBeUndefined();
  });
});

describe("map units <-> WGS84", () => {
  it("round-trips pins and puts Galle Face near its real position", () => {
    for (const pin of [
      { x: 300, y: 250 },
      { x: 566, y: 640 },
      { x: 392, y: 1236 },
    ]) {
      expect(mapFromGeo(geoFromMap(pin))).toEqual(pin);
    }
    const g = geoFromMap({ x: 300, y: 250 });
    expect(Math.abs(g.lat - 6.927)).toBeLessThan(0.01);
    expect(Math.abs(g.lng - 79.845)).toBeLessThan(0.01);
    expect(mapFromGeo({ lat: 0, lng: 0 })).toBeUndefined();
  });
});

describe("labels", () => {
  it("formats rating counts like the app", () => {
    expect(ratingCountLabel(3240)).toBe("3k+");
    expect(ratingCountLabel(640)).toBe("600+");
    expect(ratingCountLabel(42)).toBe("42");
  });

  it("describes review dates in words", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const ago = (d: number) => new Date(now - d * 86_400_000);
    expect(relativeDay(ago(0), now)).toBe("Today");
    expect(relativeDay(ago(2), now)).toBe("2 days ago");
    expect(relativeDay(ago(8), now)).toBe("Last week");
    expect(relativeDay(ago(15), now)).toBe("2 weeks ago");
  });

  it("converts phones between E.164 and the app's national format", () => {
    expect(nationalPhone("+94771234567")).toBe("771234567");
    expect(e164Phone("0771234567")).toBe("+94771234567");
    expect(e164Phone("123")).toBe("");
  });
});

describe("order status vocabulary", () => {
  it.each([
    [OrderStatus.ORDER_STATUS_PENDING, "delivery", "placed"],
    [OrderStatus.ORDER_STATUS_SCHEDULED, "delivery", "scheduled"],
    [OrderStatus.ORDER_STATUS_PLACED, "delivery", "placed"],
    [OrderStatus.ORDER_STATUS_ACCEPTED, "delivery", "accepted"],
    [OrderStatus.ORDER_STATUS_READY, "delivery", "preparing"],
    [OrderStatus.ORDER_STATUS_READY, "pickup", "ready"],
    [OrderStatus.ORDER_STATUS_PICKED_UP, "delivery", "pickedUp"],
    [OrderStatus.ORDER_STATUS_DELIVERED, "delivery", "delivered"],
    [OrderStatus.ORDER_STATUS_COLLECTED, "pickup", "collected"],
    [OrderStatus.ORDER_STATUS_REJECTED, "delivery", "cancelled"],
    [OrderStatus.ORDER_STATUS_FAILED, "delivery", "cancelled"],
  ] as const)("%s (%s) -> %s", (s, mode, want) => {
    expect(toStatus(s, mode)).toBe(want);
  });
});
