import { Inject, Injectable } from "@nestjs/common";
import {
  type CreateRestaurantRequest,
  type CreateRestaurantResponse,
  RestaurantKind,
  RestaurantManagementServiceService,
  type AddClosureRequest,
  type AddClosureResponse,
  type GetOpeningHoursRequest,
  type GetOpeningHoursResponse,
  type RemoveClosureRequest,
  type RemoveClosureResponse,
  type RestaurantDetails,
  type SetOpeningHoursRequest,
  type SetOpeningHoursResponse,
  type UpdateRestaurantDetailsRequest,
  type UpdateRestaurantDetailsResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { categories, closures, restaurants } from "../db/schema.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { alreadyExists, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { CLOCK, requireOps, requireOutletAccess, type Clock } from "./access.js";
import { CatalogEvents } from "./events.js";
import { validateWeek } from "./hours.js";
import { isUuid } from "./ids.js";
import {
  availabilityOf,
  slugify,
  toClosure,
  toDayHours,
  type ClosureRow,
  type RestaurantRow,
} from "./model.js";
import { PricingGateway } from "./pricing.client.js";
import { hasPoint, RestaurantViews } from "./restaurant-views.js";
import { CatalogStore } from "./store.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Typical ride on top of the kitchen's prep window. */
const RIDE_MIN = 10;
const RIDE_MAX = 15;
/** Fallback fee for new restaurants while pricing is unreachable: Rs 150. */
const DEFAULT_FEE_MINOR = 15_000;

/** kade.catalog.v1.RestaurantManagementService: details, hours and closures. */
@GrpcService(RestaurantManagementServiceService)
@Injectable()
export class RestaurantManagementGrpcService implements GrpcHandlers<RestaurantManagementServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
    @Inject(PricingGateway) private readonly pricing: PricingGateway,
    @Inject(RestaurantViews) private readonly views: RestaurantViews,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createRestaurant(
    request: CreateRestaurantRequest,
    ctx: RequestContext,
  ): Promise<CreateRestaurantResponse> {
    requireOps(ctx);
    const id = request.restaurantId.toLowerCase();
    if (!isUuid(id)) {
      throw invalidArgument("RESTAURANT_ID_INVALID", "Restaurant id must be the outlet's UUID.", {
        field: "restaurant_id",
      });
    }
    const details = request.details;
    if (!details?.name.trim()) {
      throw invalidArgument("RESTAURANT_NAME_REQUIRED", "Give the restaurant a name.", {
        field: "details.name",
      });
    }
    const zone = hasPoint(details.location) ? await this.pricing.resolveZone(details.location) : undefined;

    // Idempotent on restaurant_id (merchant may retry the approval), so idempotency_key adds nothing.
    const row = await this.database.transaction(ctx, async (tx) => {
      const existing = await this.store.findRestaurant(tx, id, { lock: true });
      if (existing) return existing;
      await this.assertCategory(tx, details.categoryId);
      const now = this.clock();
      let slug = slugify(details.name);
      for (let n = 2; await this.store.slugTaken(tx, slug); n++) slug = `${slugify(details.name)}-${n}`;
      const prepMin = details.prepMinMinutes > 0 ? details.prepMinMinutes : 15;
      const prepMax = Math.max(prepMin, details.prepMaxMinutes > 0 ? details.prepMaxMinutes : prepMin + 10);
      const [created] = await tx
        .insert(restaurants)
        .values({
          id,
          legacyId: await this.store.nextLegacyId(tx),
          slug,
          name: details.name.trim(),
          kind: details.kind || RestaurantKind.RESTAURANT_KIND_RESTAURANT,
          categoryId: details.categoryId,
          cuisine: details.cuisine.trim(),
          imageId: details.imageId.trim(),
          etaMinMinutes: prepMin + RIDE_MIN,
          etaMaxMinutes: prepMax + RIDE_MAX,
          baseDeliveryFeeMinor: DEFAULT_FEE_MINOR,
          priceLevel: clampPriceLevel(details.priceLevel),
          area: details.area.trim(),
          address: details.address.trim(),
          phone: details.phone.trim(),
          lat: details.location?.lat ?? 0,
          lng: details.location?.lng ?? 0,
          zoneId: zone ?? "",
          hours: defaultWeek(),
          createdAt: now,
          updatedAt: now,
        })
        // Two concurrent creates for the same id: the loser re-reads below.
        .onConflictDoNothing({ target: restaurants.id })
        .returning();
      if (!created) return (await this.store.findRestaurant(tx, id))!;
      await this.events.restaurantCreated(tx, created, [], now);
      await this.events.hoursChanged(tx, created, []);
      return created;
    });
    const [view] = await this.views.build(this.database.db, [row]);
    return { restaurant: view!.restaurant };
  }

  async updateRestaurantDetails(
    request: UpdateRestaurantDetailsRequest,
    ctx: RequestContext,
  ): Promise<UpdateRestaurantDetailsResponse> {
    const details = request.details;
    if (!details)
      throw invalidArgument("DETAILS_REQUIRED", "Send the details to change.", { field: "details" });
    const zone = hasPoint(details.location) ? await this.pricing.resolveZone(details.location) : undefined;
    const row = await this.database.transaction(ctx, async (tx) => {
      const current = await this.store.requireRestaurant(tx, request.restaurantId || ctx.outletId || "", {
        lock: true,
      });
      requireOutletAccess(ctx, current.id);
      if (details.categoryId && details.categoryId !== current.categoryId)
        await this.assertCategory(tx, details.categoryId);
      const patch = detailsPatch(current, details, zone);
      const changed = [...new Set(Object.keys(patch).map(snake))];
      if (changed.length === 0) return current;
      const updated = await this.store.updateRestaurant(tx, current.id, patch);
      const closureRows = await this.store.closuresOf(tx, current.id);
      await this.events.restaurantUpdated(tx, updated, closureRows, changed, this.clock());
      return updated;
    });
    const [view] = await this.views.build(this.database.db, [row]);
    return { restaurant: view!.restaurant };
  }

  async getOpeningHours(
    request: GetOpeningHoursRequest,
    ctx: RequestContext,
  ): Promise<GetOpeningHoursResponse> {
    const db = this.database.db;
    const row = await this.store.requireRestaurant(db, request.restaurantId || ctx.outletId || "");
    return hoursResponse(row, await this.store.closuresOf(db, row.id));
  }

  async setOpeningHours(
    request: SetOpeningHoursRequest,
    ctx: RequestContext,
  ): Promise<SetOpeningHoursResponse> {
    const result = validateWeek(request.hours);
    if (!result.ok) throw invalidArgument("HOURS_INVALID", result.message, { field: "hours" });
    return this.changeHours(ctx, request.restaurantId, async (tx, row) => {
      await this.store.updateRestaurant(tx, row.id, { hours: result.week });
    });
  }

  async addClosure(request: AddClosureRequest, ctx: RequestContext): Promise<AddClosureResponse> {
    if (!ISO_DATE.test(request.date) || Number.isNaN(Date.parse(`${request.date}T00:00:00Z`))) {
      throw invalidArgument("CLOSURE_DATE_INVALID", "Pick a date for the closure.", { field: "date" });
    }
    const reason = request.reason.trim().slice(0, 80);
    return this.changeHours(ctx, request.restaurantId, async (tx, row) => {
      const inserted = await tx
        .insert(closures)
        .values({ id: uuidv7(), restaurantId: row.id, date: request.date, reason })
        .onConflictDoNothing()
        .returning({ id: closures.id });
      if (inserted.length === 0) {
        throw alreadyExists("CLOSURE_EXISTS", "You're already closed that day.", { date: request.date });
      }
    });
  }

  async removeClosure(request: RemoveClosureRequest, ctx: RequestContext): Promise<RemoveClosureResponse> {
    return this.changeHours(ctx, request.restaurantId, async (tx, row) => {
      const deleted = isUuid(request.closureId)
        ? await tx
            .delete(closures)
            .where(and(eq(closures.id, request.closureId.toLowerCase()), eq(closures.restaurantId, row.id)))
            .returning({ id: closures.id })
        : [];
      if (deleted.length === 0) {
        throw notFound("CLOSURE_NOT_FOUND", "That closure was already removed.", {
          closure_id: request.closureId,
        });
      }
    });
  }

  /** Lock, change hours/closures, publish RestaurantHoursChanged (+ availability if it flipped). */
  private async changeHours(
    ctx: RequestContext,
    ref: string,
    change: (tx: Tx, row: RestaurantRow) => Promise<void>,
  ): Promise<SetOpeningHoursResponse> {
    return this.database.transaction(ctx, async (tx) => {
      const before = await this.store.requireRestaurant(tx, ref || ctx.outletId || "", { lock: true });
      requireOutletAccess(ctx, before.id);
      const now = this.clock();
      const closuresBefore = await this.store.closuresOf(tx, before.id);
      await change(tx, before);
      const after = (await this.store.findRestaurant(tx, before.id))!;
      const closuresAfter = await this.store.closuresOf(tx, before.id);
      await this.events.hoursChanged(tx, after, closuresAfter);
      const previous = availabilityOf(before, closuresBefore, now);
      const current = availabilityOf(after, closuresAfter, now);
      if (previous.state !== current.state || previous.closedLabel !== current.closedLabel) {
        await this.events.availabilityChanged(tx, after.id, current, previous);
      }
      return hoursResponse(after, closuresAfter);
    });
  }

  private async assertCategory(tx: Tx, categoryId: string): Promise<void> {
    const [row] = categoryId ? await tx.select().from(categories).where(eq(categories.id, categoryId)) : [];
    if (!row || row.id === "all") {
      throw invalidArgument("CATEGORY_INVALID", "Choose a food category.", { field: "details.category_id" });
    }
  }
}

function hoursResponse(row: RestaurantRow, closureRows: ClosureRow[]): GetOpeningHoursResponse {
  return { hours: toDayHours(row), closures: closureRows.map(toClosure) };
}

function defaultWeek() {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    isOpen: true,
    ranges: [{ open: "10:00", close: "22:00" }],
  }));
}

function clampPriceLevel(level: number): number {
  return Math.min(3, Math.max(1, level || 1));
}

/** Fields in `details` that are set and differ from the row. Empty/zero values mean "unchanged". */
export function detailsPatch(
  row: RestaurantRow,
  d: RestaurantDetails,
  zone: string | undefined,
): Partial<typeof restaurants.$inferInsert> {
  const patch: Partial<typeof restaurants.$inferInsert> = {};
  const text = (
    key: "name" | "cuisine" | "imageId" | "area" | "address" | "phone" | "categoryId",
    value: string,
  ) => {
    const v = value.trim();
    if (v && v !== row[key]) patch[key] = v;
  };
  text("name", d.name);
  text("categoryId", d.categoryId);
  text("cuisine", d.cuisine);
  text("imageId", d.imageId);
  text("area", d.area);
  text("address", d.address);
  text("phone", d.phone);
  if (d.kind && d.kind !== row.kind) patch.kind = d.kind;
  if (d.priceLevel && clampPriceLevel(d.priceLevel) !== row.priceLevel)
    patch.priceLevel = clampPriceLevel(d.priceLevel);
  if (hasPoint(d.location) && (d.location.lat !== row.lat || d.location.lng !== row.lng)) {
    patch.lat = d.location.lat;
    patch.lng = d.location.lng;
    if (zone !== undefined && zone !== row.zoneId) patch.zoneId = zone;
  }
  if (d.prepMinMinutes > 0 || d.prepMaxMinutes > 0) {
    const prepMin = d.prepMinMinutes > 0 ? d.prepMinMinutes : row.etaMinMinutes - RIDE_MIN;
    const prepMax = Math.max(prepMin, d.prepMaxMinutes > 0 ? d.prepMaxMinutes : row.etaMaxMinutes - RIDE_MAX);
    if (prepMin + RIDE_MIN !== row.etaMinMinutes) patch.etaMinMinutes = prepMin + RIDE_MIN;
    if (prepMax + RIDE_MAX !== row.etaMaxMinutes) patch.etaMaxMinutes = prepMax + RIDE_MAX;
  }
  return patch;
}

const snake = (key: string): string => {
  if (key === "lat" || key === "lng") return "location";
  if (key === "etaMinMinutes" || key === "etaMaxMinutes")
    return key === "etaMinMinutes" ? "eta_min_minutes" : "eta_max_minutes";
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
};
