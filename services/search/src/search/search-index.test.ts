import { AvailabilityState, MenuItem, Restaurant } from "@kade/proto/kade/catalog/v1/catalog_service";
import { describe, expect, it } from "vitest";
import type { searchRestaurants } from "../db/schema.js";
import { availabilityFor, effectiveSoldOut, restaurantView } from "./search-index.js";

type Row = typeof searchRestaurants.$inferSelect;
const at = (local: string) => new Date(`${local}+05:30`);
const now = at("2026-10-12T13:00:00");

export function row(over: Partial<Row> = {}): Row {
  return {
    id: "00000000-0000-7000-8000-000000000016",
    snapshot: Restaurant.encode(
      Restaurant.fromPartial({ id: "x", name: "Donut Republic", hoursLabel: "stale" }),
    ).finish(),
    snapshotAt: now,
    createdAt: now,
    name: "donut republic",
    searchText: "donut republic",
    nameSimple: "",
    nameEnglish: "",
    docSimple: "",
    docEnglish: "",
    lat: 6.89,
    lng: 79.855,
    availabilityState: AvailabilityState.AVAILABILITY_STATE_OPEN,
    availabilityOpensAt: null,
    availabilityAt: now,
    busyExtraMinutes: 0,
    hours: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      isOpen: true,
      ranges: [{ open: "08:00", close: "20:00" }],
    })),
    closedDates: [],
    hoursAt: now,
    menuVersion: 1,
    ...over,
  };
}

describe("availabilityFor", () => {
  it("recomputes open/closed from the hours, whatever the last event said", () => {
    expect(
      availabilityFor(
        row({
          availabilityState: AvailabilityState.AVAILABILITY_STATE_CLOSED,
          availabilityOpensAt: at("2026-10-12T08:00:00"),
        }),
        now,
      ).state,
    ).toBe(AvailabilityState.AVAILABILITY_STATE_OPEN);
    expect(availabilityFor(row(), at("2026-10-12T06:00:00"))).toMatchObject({
      state: AvailabilityState.AVAILABILITY_STATE_CLOSED,
      closedLabel: "Opens at 8 am",
    });
  });

  it("keeps suspension, pauses and ops closures from the events", () => {
    expect(
      availabilityFor(row({ availabilityState: AvailabilityState.AVAILABILITY_STATE_SUSPENDED }), now).state,
    ).toBe(AvailabilityState.AVAILABILITY_STATE_SUSPENDED);
    expect(
      availabilityFor(
        row({
          availabilityState: AvailabilityState.AVAILABILITY_STATE_PAUSED,
          availabilityOpensAt: at("2026-10-12T19:30:00"),
        }),
        now,
      ),
    ).toMatchObject({ state: AvailabilityState.AVAILABILITY_STATE_PAUSED, closedLabel: "Back at 7:30 pm" });
    // A pause that has run out is just the hours again.
    expect(
      availabilityFor(
        row({
          availabilityState: AvailabilityState.AVAILABILITY_STATE_PAUSED,
          availabilityOpensAt: at("2026-10-12T12:00:00"),
        }),
        now,
      ).state,
    ).toBe(AvailabilityState.AVAILABILITY_STATE_OPEN);
    expect(
      availabilityFor(row({ availabilityState: AvailabilityState.AVAILABILITY_STATE_CLOSED }), now).state,
    ).toBe(AvailabilityState.AVAILABILITY_STATE_CLOSED);
  });
});

describe("restaurantView", () => {
  it("overlays live availability, today's hours and distance on the snapshot", () => {
    const r = restaurantView(row(), now, { lat: 6.91, lng: 79.8517 });
    expect(r).toMatchObject({ name: "Donut Republic", hoursLabel: "8 am – 8 pm", distanceKm: 2.3 });
    expect(r.deliveryFee).toBeUndefined();
    expect(restaurantView(row(), now, undefined).distanceKm).toBe(0);
  });
});

it("treats sold out as over once sold_out_until passes", () => {
  const item = MenuItem.fromPartial({ soldOut: true });
  expect(effectiveSoldOut(item, now)).toBe(true);
  expect(effectiveSoldOut({ ...item, soldOutUntil: at("2026-10-12T11:00:00") }, now)).toBe(false);
});
