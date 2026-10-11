import { Inject, Injectable } from "@nestjs/common";
import type { Restaurant } from "@kade/proto/kade/catalog/v1/catalog_service";
import type { PageRequest, PageResponse } from "@kade/proto/kade/common/v1/types";
import {
  SearchServiceService,
  type DishHit,
  type ListPopularSearchesResponse,
  type Place,
  type RebuildIndexResponse,
  type ReverseGeocodeRequest,
  type ReverseGeocodeResponse,
  type SearchPlacesRequest,
  type SearchPlacesResponse,
  type SearchRequest,
  type SearchResponse,
} from "@kade/proto/kade/search/v1/search_service";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { Backfill } from "./backfill.js";
import { distanceKm } from "./geo.js";
import { PricingGateway } from "./pricing.client.js";
import { effectiveSoldOut, isOpen, restaurantView, SearchIndex } from "./search-index.js";
import { normalise } from "./text.js";
import type { places } from "../db/schema.js";
import { AvailabilityState } from "@kade/proto/kade/catalog/v1/catalog_service";

const DEFAULT_DISHES = 40;
const MAX_DISHES = 100;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const DEFAULT_PLACES = 6;

type PlaceRow = typeof places.$inferSelect;

/** kade.search.v1.SearchService. Reads only the projection; never calls catalog on the read path. */
@GrpcService(SearchServiceService)
@Injectable()
export class SearchGrpcService implements GrpcHandlers<SearchServiceService> {
  constructor(
    @Inject(SearchIndex) private readonly index: SearchIndex,
    @Inject(PricingGateway) private readonly pricing: PricingGateway,
    @Inject(Backfill) private readonly backfill: Backfill,
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query;
    const now = this.index.now();
    const found = await this.index.find(query);
    const deliverTo = request.deliverTo;

    const views = new Map<string, Restaurant>();
    for (const [id, row] of found.rows) views.set(id, restaurantView(row, now, deliverTo));
    const visible = (id: string) => {
      const r = views.get(id);
      return r && r.availability?.state !== AvailabilityState.AVAILABILITY_STATE_SUSPENDED ? r : undefined;
    };
    const order = new Map(
      [...found.rows.values()].map((row) => [row.id, [row.createdAt?.getTime() ?? 0, row.id] as const]),
    );
    const byFeedOrder = (a: string, b: string) => {
      const [ta, ia] = order.get(a)!;
      const [tb, ib] = order.get(b)!;
      return ta - tb || (ia < ib ? -1 : ia > ib ? 1 : 0);
    };

    // Restaurants: open first, then name matches, then feed order.
    const restaurants = found.restaurants
      .filter((r) => visible(r.row.id))
      .sort(
        (a, b) =>
          Number(isOpen(views.get(b.row.id)!)) - Number(isOpen(views.get(a.row.id)!)) ||
          Number(b.nameMatch) - Number(a.nameMatch) ||
          byFeedOrder(a.row.id, b.row.id),
      )
      .map((r) => views.get(r.row.id)!);

    // Dishes: name matches first, available before sold out, open places first, then menu order.
    const dishes = found.dishes
      .filter((d) => visible(d.restaurantId))
      .map((d) => ({ ...d, soldOut: effectiveSoldOut(d.item, now) }))
      .sort(
        (a, b) =>
          Number(b.nameMatch) - Number(a.nameMatch) ||
          Number(a.soldOut) - Number(b.soldOut) ||
          Number(isOpen(views.get(b.restaurantId)!)) - Number(isOpen(views.get(a.restaurantId)!)) ||
          byFeedOrder(a.restaurantId, b.restaurantId) ||
          a.sectionPosition - b.sectionPosition ||
          a.position - b.position,
      )
      .slice(0, clamp(request.maxDishes, DEFAULT_DISHES, MAX_DISHES));

    const { slice, page } = paginate(restaurants, request.page);
    const shown = new Set([...slice.map((r) => r.id), ...dishes.map((d) => d.restaurantId)]);
    await this.fillFees(
      [...shown].map((id) => views.get(id)!),
      found.rows,
      deliverTo,
    );

    const hits: DishHit[] = dishes.map((d) => ({
      item: { ...d.item, soldOut: d.soldOut, soldOutUntil: d.soldOut ? d.item.soldOutUntil : undefined },
      restaurant: views.get(d.restaurantId),
    }));
    return { query, dishes: hits, restaurants: slice, page };
  }

  async listPopularSearches(): Promise<ListPopularSearchesResponse> {
    return { queries: await this.index.popularSearches() };
  }

  async searchPlaces(request: SearchPlacesRequest): Promise<SearchPlacesResponse> {
    const q = normalise(request.query);
    if (q.length < 2) return { places: [] };
    const limit = clamp(request.limit, DEFAULT_PLACES, 20);
    // Same scoring as the app: name starts with it, then contains it, then detail/area contains it.
    const score = (p: PlaceRow): number => {
      const name = normalise(p.name);
      if (name.startsWith(q)) return 0;
      if (name.includes(q)) return 1;
      return normalise(`${p.detail} ${p.area}`).includes(q) ? 2 : 3;
    };
    const ranked = (await this.index.places())
      .map((p) => [p, score(p)] as const)
      .filter(([, s]) => s < 3)
      .sort((a, b) => a[1] - b[1] || a[0].position - b[0].position)
      .slice(0, limit)
      .map(([p]) => toPlace(p));
    return { places: ranked };
  }

  async reverseGeocode(request: ReverseGeocodeRequest): Promise<ReverseGeocodeResponse> {
    const at = request.location;
    if (!at || (at.lat === 0 && at.lng === 0)) {
      throw invalidArgument("LOCATION_REQUIRED", "Drop the pin somewhere first.", { field: "location" });
    }
    const candidates = (await this.index.places()).filter((p) => p.inZone);
    let best: PlaceRow | undefined;
    let bestKm = Infinity;
    for (const p of candidates) {
      const km = distanceKm(at, { lat: p.lat, lng: p.lng });
      if (km < bestKm) [best, bestKm] = [p, km];
    }
    if (!best) throw notFound("PLACE_NOT_FOUND", "We couldn't find a place near there.");
    return { place: toPlace(best) };
  }

  async rebuildIndex(_request: unknown, ctx: RequestContext): Promise<RebuildIndexResponse> {
    if (ctx.userId) ctx.requireRole("ops", "admin");
    return { startedAt: await this.backfill.rebuild() };
  }

  /** Delivery fees from pricing when we know where the customer is; unset otherwise. */
  private async fillFees(
    restaurants: Restaurant[],
    rows: Map<string, { lat: number; lng: number }>,
    deliverTo: SearchRequest["deliverTo"],
  ): Promise<void> {
    if (!deliverTo || (deliverTo.lat === 0 && deliverTo.lng === 0) || restaurants.length === 0) return;
    const quotes = await this.pricing.quoteFees(
      restaurants.map((r) => ({ id: r.id, lat: rows.get(r.id)?.lat ?? 0, lng: rows.get(r.id)?.lng ?? 0 })),
      deliverTo,
    );
    if (!quotes) return;
    for (const r of restaurants) {
      const q = quotes.get(r.id);
      if (q) r.deliveryFee = { amountMinor: r.freeDeliveryOffer ? 0 : q.feeMinor, currency: "LKR" };
    }
  }
}

function toPlace(p: PlaceRow): Place {
  return {
    id: p.id,
    name: p.name,
    detail: p.detail,
    area: p.area,
    location: { lat: p.lat, lng: p.lng },
    inZone: p.inZone,
    zoneId: p.zoneId,
  };
}

function clamp(value: number, fallback: number, max: number): number {
  return Math.min(max, value > 0 ? value : fallback);
}

export function paginate<T>(list: T[], page: PageRequest | undefined): { slice: T[]; page: PageResponse } {
  const size = clamp(page?.pageSize ?? 0, DEFAULT_PAGE, MAX_PAGE);
  let offset = 0;
  if (page?.pageToken) {
    const raw = Buffer.from(page.pageToken, "base64url").toString("utf8");
    if (!/^\d{1,9}$/.test(raw)) {
      throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", {
        field: "page.page_token",
      });
    }
    offset = Number(raw);
  }
  const slice = list.slice(offset, offset + size);
  const next = offset + size < list.length ? Buffer.from(String(offset + size)).toString("base64url") : "";
  return { slice, page: { nextPageToken: next, totalSize: list.length } };
}
