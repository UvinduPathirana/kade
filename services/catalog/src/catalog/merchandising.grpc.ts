import { Inject, Injectable } from "@nestjs/common";
import {
  CollectionPlacement,
  CollectionSource,
  MerchandisingServiceService,
  type ListCollectionsResponse,
  type ListHomeCategoriesResponse,
  type MoveCollectionRequest,
  type MoveCollectionResponse,
  type MoveHomeCategoryRequest,
  type MoveHomeCategoryResponse,
  type SaveCollectionRequest,
  type SaveCollectionResponse,
  type SetCollectionVisibleRequest,
  type SetCollectionVisibleResponse,
  type UpdateHomeCategoryRequest,
  type UpdateHomeCategoryResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { categories, collections, type CollectionRuleJson } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { requireOps } from "./access.js";
import { isUuid, parseRestaurantRef, restaurantId } from "./ids.js";
import { directionStep } from "./menu-management.grpc.js";
import { toCategory, toCollection } from "./model.js";
import { CatalogStore } from "./store.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** kade.catalog.v1.MerchandisingService: the admin console's home-feed content. */
@GrpcService(MerchandisingServiceService)
@Injectable()
export class MerchandisingGrpcService implements GrpcHandlers<MerchandisingServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CatalogStore) private readonly store: CatalogStore,
  ) {}

  async listHomeCategories(_request: unknown, ctx: RequestContext): Promise<ListHomeCategoriesResponse> {
    requireOps(ctx);
    return { categories: (await this.store.categories(this.database.db)).map(toCategory) };
  }

  async updateHomeCategory(
    request: UpdateHomeCategoryRequest,
    ctx: RequestContext,
  ): Promise<UpdateHomeCategoryResponse> {
    requireOps(ctx);
    const patch: Partial<typeof categories.$inferInsert> = {};
    if (request.label !== undefined) {
      const label = request.label.trim();
      if (!label)
        throw invalidArgument("CATEGORY_LABEL_REQUIRED", "Give the category a name.", { field: "label" });
      patch.label = label;
    }
    if (request.imageId !== undefined) patch.imageId = request.imageId.trim();
    if (request.visible !== undefined) patch.visible = request.visible;
    return this.database.transaction(ctx, async (tx) => {
      const updated = Object.keys(patch).length
        ? await tx.update(categories).set(patch).where(eq(categories.id, request.id)).returning()
        : await tx.select().from(categories).where(eq(categories.id, request.id));
      if (updated.length === 0)
        throw notFound("CATEGORY_NOT_FOUND", "We couldn't find that category.", { id: request.id });
      return { categories: (await this.store.categories(tx)).map(toCategory) };
    });
  }

  async moveHomeCategory(
    request: MoveHomeCategoryRequest,
    ctx: RequestContext,
  ): Promise<MoveHomeCategoryResponse> {
    requireOps(ctx);
    const step = directionStep(request.direction);
    return this.database.transaction(ctx, async (tx) => {
      await tx.execute(sql`lock table ${categories} in share row exclusive mode`);
      const list = await this.store.categories(tx);
      const i = list.findIndex((c) => c.id === request.id);
      if (i < 0) throw notFound("CATEGORY_NOT_FOUND", "We couldn't find that category.", { id: request.id });
      const a = list[i]!;
      const b = list[i + step];
      if (!b)
        throw failedPrecondition("CATEGORY_CANNOT_MOVE", "That category can't move further.", {
          id: request.id,
        });
      await tx.update(categories).set({ position: b.position }).where(eq(categories.id, a.id));
      await tx.update(categories).set({ position: a.position }).where(eq(categories.id, b.id));
      return { categories: (await this.store.categories(tx)).map(toCategory) };
    });
  }

  async listCollections(_request: unknown, ctx: RequestContext): Promise<ListCollectionsResponse> {
    requireOps(ctx);
    return { collections: (await this.store.collections(this.database.db)).map(toCollection) };
  }

  async saveCollection(request: SaveCollectionRequest, ctx: RequestContext): Promise<SaveCollectionResponse> {
    requireOps(ctx);
    const c = request.collection;
    if (!c)
      throw invalidArgument("COLLECTION_REQUIRED", "Send the collection to save.", { field: "collection" });
    const title = c.title.trim();
    if (!title) {
      throw invalidArgument("COLLECTION_TITLE_REQUIRED", "Give the collection a title customers will see.", {
        field: "collection.title",
      });
    }
    if (
      c.placement !== CollectionPlacement.COLLECTION_PLACEMENT_BANNER &&
      c.placement !== CollectionPlacement.COLLECTION_PLACEMENT_SHELF
    ) {
      throw invalidArgument("COLLECTION_PLACEMENT_REQUIRED", "Choose a banner or a shelf.", {
        field: "collection.placement",
      });
    }
    if (
      c.source !== CollectionSource.COLLECTION_SOURCE_RULES &&
      c.source !== CollectionSource.COLLECTION_SOURCE_HAND_PICKED
    ) {
      throw invalidArgument("COLLECTION_SOURCE_REQUIRED", "Choose rules or hand-picked restaurants.", {
        field: "collection.source",
      });
    }
    const restaurantIds = c.restaurantIds.map((ref) => {
      const parsed = parseRestaurantRef(ref);
      if (!parsed)
        throw invalidArgument("RESTAURANT_ID_INVALID", "Restaurant ids must be UUIDs.", { id: ref });
      return "id" in parsed ? parsed.id : restaurantId(parsed.legacyId);
    });
    if (c.source === CollectionSource.COLLECTION_SOURCE_HAND_PICKED && restaurantIds.length < 2) {
      throw invalidArgument(
        "COLLECTION_TOO_FEW_RESTAURANTS",
        "Pick at least two restaurants for a hand-picked collection.",
        {
          field: "collection.restaurant_ids",
        },
      );
    }
    for (const [field, value] of [
      ["starts_on", c.startsOn],
      ["ends_on", c.endsOn],
    ] as const) {
      if (value && !ISO_DATE.test(value)) {
        throw invalidArgument("COLLECTION_DATE_INVALID", "Dates must look like 2026-10-31.", {
          field: `collection.${field}`,
        });
      }
    }
    if (c.endsOn && c.startsOn && c.endsOn < c.startsOn) {
      throw invalidArgument("COLLECTION_DATES_INVERTED", "The end date is before the start date.", {
        field: "collection.ends_on",
      });
    }
    const rule: CollectionRuleJson = {};
    if (c.rule?.categoryId) rule.categoryId = c.rule.categoryId;
    if (c.rule?.minRating) rule.minRating = c.rule.minRating;
    if (c.rule?.maxEtaMinutes) rule.maxEtaMinutes = c.rule.maxEtaMinutes;
    if (c.rule?.offersOnly) rule.offersOnly = true;
    const values = {
      title,
      subtitle: c.subtitle.trim(),
      placement: c.placement,
      source: c.source,
      rule: c.source === CollectionSource.COLLECTION_SOURCE_RULES ? rule : {},
      restaurantIds: c.source === CollectionSource.COLLECTION_SOURCE_HAND_PICKED ? restaurantIds : [],
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      visible: c.visible,
    };

    return this.database.transaction(ctx, async (tx) => {
      if (c.id) {
        if (!isUuid(c.id))
          throw notFound("COLLECTION_NOT_FOUND", "We couldn't find that collection.", { id: c.id });
        const [row] = await tx
          .update(collections)
          .set(values)
          .where(eq(collections.id, c.id.toLowerCase()))
          .returning();
        if (!row) throw notFound("COLLECTION_NOT_FOUND", "We couldn't find that collection.", { id: c.id });
        return { collection: toCollection(row) };
      }
      const [max] = await tx
        .select({ max: sql<number>`coalesce(max(${collections.position}), -1)` })
        .from(collections);
      const [row] = await tx
        .insert(collections)
        .values({ id: uuidv7(), position: Number(max?.max ?? -1) + 1, ...values })
        .returning();
      return { collection: toCollection(row!) };
    });
  }

  async setCollectionVisible(
    request: SetCollectionVisibleRequest,
    ctx: RequestContext,
  ): Promise<SetCollectionVisibleResponse> {
    requireOps(ctx);
    const [row] = isUuid(request.id)
      ? await this.database.db
          .update(collections)
          .set({ visible: request.visible })
          .where(eq(collections.id, request.id.toLowerCase()))
          .returning()
      : [];
    if (!row) throw notFound("COLLECTION_NOT_FOUND", "We couldn't find that collection.", { id: request.id });
    return { collection: toCollection(row) };
  }

  async moveCollection(request: MoveCollectionRequest, ctx: RequestContext): Promise<MoveCollectionResponse> {
    requireOps(ctx);
    const step = directionStep(request.direction);
    return this.database.transaction(ctx, async (tx) => {
      await tx.execute(sql`lock table ${collections} in share row exclusive mode`);
      const list = await this.store.collections(tx);
      const i = list.findIndex((c) => c.id === request.id.toLowerCase());
      if (i < 0)
        throw notFound("COLLECTION_NOT_FOUND", "We couldn't find that collection.", { id: request.id });
      const a = list[i]!;
      const b = list[i + step];
      if (!b)
        throw failedPrecondition("COLLECTION_CANNOT_MOVE", "That collection can't move further.", {
          id: request.id,
        });
      await tx.update(collections).set({ position: b.position }).where(eq(collections.id, a.id));
      await tx.update(collections).set({ position: a.position }).where(eq(collections.id, b.id));
      return { collections: (await this.store.collections(tx)).map(toCollection) };
    });
  }
}
