import { Inject, Injectable } from "@nestjs/common";
import { AvailabilityState, type Restaurant } from "@kade/proto/kade/catalog/v1/catalog_service";
import { FulfilmentMode } from "@kade/proto/kade/common/v1/commerce";
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import type { Queryable } from "../platform/db/database.js";
import { CLOCK, type Clock } from "./access.js";
import { toRestaurant, type RestaurantRow } from "./model.js";
import { PricingGateway } from "./pricing.client.js";
import { CatalogStore } from "./store.js";

export interface ViewOptions {
  deliverTo?: GeoPoint;
  mode?: FulfilmentMode;
}

export interface RestaurantView {
  restaurant: Restaurant;
  /** Pricing says the customer's location is outside this restaurant's delivery area. */
  outOfZone: boolean;
}

export const hasPoint = (p: GeoPoint | undefined): p is GeoPoint => !!p && (p.lat !== 0 || p.lng !== 0);

/** Turns restaurant rows into customer-facing Restaurant messages (availability, distance, fee). */
@Injectable()
export class RestaurantViews {
  constructor(
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(PricingGateway) private readonly pricing: PricingGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async build(q: Queryable, rows: RestaurantRow[], opts: ViewOptions = {}): Promise<RestaurantView[]> {
    const now = this.clock();
    const pickup = opts.mode === FulfilmentMode.FULFILMENT_MODE_PICKUP;
    const deliverTo = hasPoint(opts.deliverTo) ? opts.deliverTo : undefined;
    const [closures, quotes] = await Promise.all([
      this.store.closuresFor(
        q,
        rows.map((r) => r.id),
      ),
      deliverTo && !pickup ? this.pricing.quoteFees(rows, deliverTo) : Promise.resolve(undefined),
    ]);
    return rows.map((row) => {
      const quote = quotes?.get(row.id);
      return {
        restaurant: toRestaurant(row, closures.get(row.id) ?? [], now, {
          deliverTo,
          pickup,
          deliveryFeeMinor: quote?.feeMinor,
        }),
        outOfZone: quote?.outOfZone ?? false,
      };
    });
  }
}

export const isOpen = (r: Restaurant): boolean =>
  r.availability?.state === AvailabilityState.AVAILABILITY_STATE_OPEN;
export const isSuspended = (r: Restaurant): boolean =>
  r.availability?.state === AvailabilityState.AVAILABILITY_STATE_SUSPENDED;

/** Open restaurants first, then by distance (when known); stable otherwise. */
export function feedOrder(a: Restaurant, b: Restaurant): number {
  return Number(isOpen(b)) - Number(isOpen(a)) || a.distanceKm - b.distanceKm;
}
