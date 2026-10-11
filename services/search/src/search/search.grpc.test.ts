import { Metadata, status } from "@grpc/grpc-js";
import { AvailabilityState, MenuItem, Restaurant } from "@kade/proto/kade/catalog/v1/catalog_service";
import { SearchRequest } from "@kade/proto/kade/search/v1/search_service";
import { beforeEach, describe, expect, it } from "vitest";
import { createRequestContext } from "../platform/grpc/context.js";
import type { DomainError } from "../platform/grpc/errors.js";
import type { Backfill } from "./backfill.js";
import { seedPlaces } from "./places-data.js";
import type { PricingGateway } from "./pricing.client.js";
import { paginate, SearchGrpcService } from "./search.grpc.js";
import type { DishCandidate, SearchIndex } from "./search-index.js";
import { row } from "./search-index.test.js";

const now = new Date("2026-10-12T13:00:00+05:30");
const ID = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const snapshot = (n: number, name: string) =>
  Restaurant.encode(Restaurant.fromPartial({ id: ID(n), name })).finish();

const rows = new Map([
  [ID(1), row({ id: ID(1), snapshot: snapshot(1, "Open Kottu") })],
  // Closed at 1 pm (opens at 3 pm).
  [
    ID(11),
    row({
      id: ID(11),
      snapshot: snapshot(11, "Evening Kottu"),
      hours: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        isOpen: true,
        ranges: [{ open: "15:00", close: "23:00" }],
      })),
    }),
  ],
  [
    ID(3),
    row({
      id: ID(3),
      snapshot: snapshot(3, "Suspended Kottu"),
      availabilityState: AvailabilityState.AVAILABILITY_STATE_SUSPENDED,
    }),
  ],
]);
const dish = (
  id: string,
  restaurant: number,
  name: string,
  nameMatch: boolean,
  soldOut = false,
  position = 0,
): DishCandidate => ({
  item: MenuItem.fromPartial({ id, name, soldOut }),
  restaurantId: ID(restaurant),
  nameMatch,
  sectionPosition: 0,
  position,
});

let found: Awaited<ReturnType<SearchIndex["find"]>>;
let service: SearchGrpcService;
let rebuilds = 0;

beforeEach(() => {
  rebuilds = 0;
  found = {
    restaurants: [
      { row: rows.get(ID(11))!, nameMatch: true },
      { row: rows.get(ID(3))!, nameMatch: true },
      { row: rows.get(ID(1))!, nameMatch: false },
    ],
    dishes: [
      dish("d1", 11, "Kottu A", true),
      dish("d2", 1, "Desc match", false),
      dish("d3", 1, "Kottu sold", true, true),
      dish("d4", 1, "Kottu B", true, false, 1),
      dish("d5", 3, "Hidden kottu", true),
    ],
    rows,
  };
  const index = {
    now: () => now,
    find: async () => found,
    popularSearches: async () => ["Kottu"],
    places: async () => seedPlaces.map((p, position) => ({ ...p, position })),
  } as unknown as SearchIndex;
  const pricing = { quoteFees: async () => undefined } as unknown as PricingGateway;
  const backfill = { rebuild: async () => (rebuilds++, now) } as unknown as Backfill;
  service = new SearchGrpcService(index, pricing, backfill);
});

describe("search ordering", () => {
  it("puts open places first, then name matches; hides suspended ones", async () => {
    const res = await service.search(SearchRequest.fromPartial({ query: "kottu" }));
    expect(res.restaurants.map((r) => r.name)).toEqual(["Open Kottu", "Evening Kottu"]);
  });

  it("orders dishes: name matches, available before sold out, open places first, then menu order", async () => {
    const res = await service.search(SearchRequest.fromPartial({ query: "kottu" }));
    expect(res.dishes.map((d) => d.item!.id)).toEqual(["d4", "d1", "d3", "d2"]);
    expect(res.dishes[0]!.restaurant?.name).toBe("Open Kottu");
  });

  it("caps dishes at max_dishes", async () => {
    const res = await service.search(SearchRequest.fromPartial({ query: "kottu", maxDishes: 2 }));
    expect(res.dishes).toHaveLength(2);
  });
});

describe("places", () => {
  it("ranks names that start with the query first and ignores one letter", async () => {
    expect((await service.searchPlaces({ query: "d", limit: 0 })).places).toEqual([]);
    const res = await service.searchPlaces({ query: "dehi", limit: 0 });
    expect(res.places.map((p) => p.name)).toEqual(["Dehiwala Junction", "Dehiwala Zoo"]);
    expect(res.places[0]).toMatchObject({ inZone: true, zoneId: "deh" });
    const out = await service.searchPlaces({ query: "kandy", limit: 0 });
    expect(out.places[0]).toMatchObject({ name: "Kandy", inZone: false });
  });

  it("reverse geocodes to the nearest in-zone place", async () => {
    const res = await service.reverseGeocode({
      location: { lat: 6.9457 - 0.00007126 * 742, lng: 79.82772 + 0.00006806 * 364 },
    });
    expect(res.place?.id).toBe("majestic-city");
  });
});

describe("rebuildIndex", () => {
  it("is for ops and admin (internal calls are trusted)", async () => {
    const md = new Metadata();
    md.set("x-user-id", "u");
    md.set("x-roles", "customer");
    const err = await service
      .rebuildIndex({}, createRequestContext({ metadata: md }))
      .catch((e: unknown) => e);
    expect((err as DomainError).code).toBe(status.PERMISSION_DENIED);
    expect(await service.rebuildIndex({}, createRequestContext({ metadata: new Metadata() }))).toEqual({
      startedAt: now,
    });
    expect(rebuilds).toBe(1);
  });
});

it("paginates restaurants", () => {
  const first = paginate([1, 2, 3], { pageSize: 2, pageToken: "" });
  expect(first.slice).toEqual([1, 2]);
  expect(paginate([1, 2, 3], { pageSize: 2, pageToken: first.page.nextPageToken }).slice).toEqual([3]);
});
