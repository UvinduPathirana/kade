import { Inject, Injectable } from "@nestjs/common";
import { OutletStatusChanged } from "@kade/proto/kade/merchant/v1/merchant_events";
import { OutletAdminStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import { OfferActivated, OfferEnded } from "@kade/proto/kade/promotion/v1/promotion_events";
import { OfferType } from "@kade/proto/kade/promotion/v1/promotion_service";
import { RestaurantRatingChanged } from "@kade/proto/kade/review/v1/review_events";
import type { restaurants } from "../db/schema.js";
import type { Tx } from "../platform/db/database.js";
import { EventConsumer, OnEvent, type EventContext } from "../platform/kafka/event-handler.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { CLOCK, type Clock } from "./access.js";
import { CatalogEvents } from "./events.js";
import { availabilityOf } from "./model.js";
import { CatalogStore } from "./store.js";

type Patch = Partial<typeof restaurants.$inferInsert>;

export const UPSTREAM = {
  outletStatusChanged: "kade.merchant.v1.OutletStatusChanged",
  ratingChanged: "kade.review.v1.RestaurantRatingChanged",
  offerActivated: "kade.promotion.v1.OfferActivated",
  offerEnded: "kade.promotion.v1.OfferEnded",
} as const;

const ADMIN_STATUS: Record<number, string> = {
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN]: "open",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_PAUSED]: "paused",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED]: "suspended",
  [OutletAdminStatus.OUTLET_ADMIN_STATUS_CLOSED]: "closed",
};

/**
 * Facts other services own, folded into the restaurant read model: pause/busy/suspension from
 * merchant, ratings from review, running offers from promotion. Each change is re-published as a
 * catalog event so search and the apps see one consistent restaurant snapshot.
 */
@EventConsumer({ topics: ["kade.merchant.events", "kade.review.events", "kade.promotion.events"] })
@Injectable()
export class UpstreamEventsConsumer {
  constructor(
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @OnEvent(UPSTREAM.outletStatusChanged, OutletStatusChanged)
  async outletStatusChanged(event: OutletStatusChanged, ctx: EventContext): Promise<void> {
    const s = event.status;
    if (!s) return;
    await this.apply(ctx.tx, event.outletId, {
      busyExtraMinutes: Math.max(0, s.busyExtraMinutes),
      pausedUntil: s.pausedUntil ?? null,
      adminStatus: ADMIN_STATUS[s.adminStatus] ?? "open",
      adminStatusReason: s.adminStatusReason,
    });
  }

  @OnEvent(UPSTREAM.ratingChanged, RestaurantRatingChanged)
  async ratingChanged(event: RestaurantRatingChanged, ctx: EventContext): Promise<void> {
    if (!event.summary) return;
    await this.apply(ctx.tx, event.restaurantId, {
      rating: Math.round(event.summary.average * 10) / 10,
      ratingCount: event.summary.count,
    });
  }

  @OnEvent(UPSTREAM.offerActivated, OfferActivated)
  async offerActivated(event: OfferActivated, ctx: EventContext): Promise<void> {
    const offer = event.offer;
    await this.apply(ctx.tx, event.restaurantId, {
      offerId: event.offerId,
      offerLabel: offer?.label ?? "",
      discountPercent: offer?.type === OfferType.OFFER_TYPE_PERCENT ? offer.percent : 0,
      freeDeliveryOffer: offer?.type === OfferType.OFFER_TYPE_FREE_DELIVERY,
    });
  }

  @OnEvent(UPSTREAM.offerEnded, OfferEnded)
  async offerEnded(event: OfferEnded, ctx: EventContext): Promise<void> {
    const row = await this.store.findRestaurant(ctx.tx, event.restaurantId);
    // Only clear the offer that ended, not a newer one that replaced it.
    if (!row || row.offerId !== event.offerId) return;
    await this.apply(ctx.tx, event.restaurantId, {
      offerId: "",
      offerLabel: "",
      discountPercent: 0,
      freeDeliveryOffer: false,
    });
  }

  /** Applies a patch to a restaurant and publishes what changed. Unknown restaurants are skipped. */
  private async apply(tx: Tx, ref: string, patch: Patch): Promise<void> {
    const before = await this.store.findRestaurant(tx, ref, { lock: true });
    if (!before) {
      this.logger.debug({ restaurantId: ref }, "event for an unknown restaurant; skipped");
      return;
    }
    const changed = (Object.keys(patch) as (keyof Patch)[]).filter(
      (k) => !same(before[k as keyof typeof before], patch[k]),
    );
    if (changed.length === 0) return;
    const after = await this.store.updateRestaurant(tx, before.id, patch);
    const now = this.clock();
    const closures = await this.store.closuresOf(tx, before.id);
    const previous = availabilityOf(before, closures, now);
    const current = availabilityOf(after, closures, now);
    if (
      previous.state !== current.state ||
      previous.closedLabel !== current.closedLabel ||
      previous.busyExtraMinutes !== current.busyExtraMinutes
    ) {
      await this.events.availabilityChanged(tx, after.id, current, previous);
    }
    const snapshotFields = changed.filter(
      (k) => k !== "pausedUntil" && k !== "adminStatus" && k !== "adminStatusReason",
    );
    if (snapshotFields.length) {
      await this.events.restaurantUpdated(
        tx,
        after,
        closures,
        snapshotFields.map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
        now,
      );
    }
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : a) === (b instanceof Date ? b.getTime() : b);
  }
  return a === b;
}
