import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  CollectionPlacement,
  CollectionSource,
  ListCollectionsRequest,
  ListHomeCategoriesRequest,
  MoveCollectionRequest,
  MoveDirection,
  MoveHomeCategoryRequest,
  SaveCollectionRequest,
  SetCollectionVisibleRequest,
  UpdateHomeCategoryRequest,
  type Category,
  type Collection as ProtoCollection,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { Type } from "typebox";
import { badRequest, notFound } from "../context.js";
import { restaurantNumber, restaurantUuid } from "../ids.js";
import { soft } from "../lib.js";
import { toRestaurant } from "../mappers/partners.js";
import { Collection, HomeCategory, HomeContent, listOf, problems, ref, SaveCollection } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["content"];

// The photo library editors pick category and banner images from (Unsplash photo ids). Static for
// now; an upload flow would move it into catalog.
export const IMAGE_LIBRARY = Object.entries({
  kottu: "1589302168068-964664d93dc0",
  biryani: "1563379091339-03b21ab4a4f8",
  curry: "1585937421612-70a008356fbe",
  curry2: "1596797038530-2c107229654b",
  fishCurry: "1574484284002-952d92456975",
  samosa: "1601050690597-df0568f70950",
  buns: "1606491956689-2ea866880c84",
  chaat: "1610192244261-3f33de3f55e4",
  ramen: "1569718212165-3a8278d5f624",
  sushi: "1579871494447-9811cf80d66c",
  burger: "1568901346375-23c9450c58cd",
  chicken: "1626074353765-517a681e40be",
  pizza: "1513104890138-7c749659a591",
  salad: "1512621776951-a57141f2eefd",
  bowl: "1546069901-ba9599a7e63c",
  spread: "1504674900247-0877df9cc836",
  donut: "1551024601-bec78aea704b",
  pudding: "1488477181946-6428a0291777",
  grocery: "1542838132-92c53300491e",
}).map(([name, id]) => ({ name, id }));

export const toCategory = (c: Category): HomeCategory => ({
  id: c.id,
  label: c.label,
  imageId: c.imageId,
  visible: c.visible,
});

export function toCollection(c: ProtoCollection): Collection {
  const rules = c.source === CollectionSource.COLLECTION_SOURCE_RULES;
  const r = c.rule;
  return {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    placement: c.placement === CollectionPlacement.COLLECTION_PLACEMENT_BANNER ? "banner" : "shelf",
    source: rules ? "rules" : "handPicked",
    rule:
      rules && r
        ? {
            category: r.categoryId || undefined,
            minRating: r.minRating > 0 ? r.minRating : undefined,
            maxEta: r.maxEtaMinutes > 0 ? r.maxEtaMinutes : undefined,
            offersOnly: r.offersOnly || undefined,
          }
        : rules
          ? {}
          : undefined,
    restaurantIds: c.restaurantIds.map(restaurantNumber),
    startsOn: c.startsOn,
    endsOn: c.endsOn || undefined,
    visible: c.visible,
  };
}

const sortByPosition = <T extends { position: number }>(xs: T[]) =>
  [...xs].sort((a, b) => a.position - b.position);
const Direction = Type.Union([Type.Literal(-1), Type.Literal(1)]);
const dir = (d: -1 | 1) => (d < 0 ? MoveDirection.MOVE_DIRECTION_UP : MoveDirection.MOVE_DIRECTION_DOWN);

export const contentRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/v1/content",
    {
      schema: {
        operationId: "getHomeContent",
        tags,
        security,
        summary:
          "Home feed categories and collections (catalog), restaurants to pick from (merchant), images.",
        response: { 200: ref(HomeContent), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const [cats, cols, outlets] = await Promise.all([
        ctx.rpc(ctx.up.merchandising, "listHomeCategories", ListHomeCategoriesRequest.fromPartial({})),
        ctx.rpc(ctx.up.merchandising, "listCollections", ListCollectionsRequest.fromPartial({})),
        soft(ctx.log, "outlets", ctx.outlets(), []),
      ]);
      return {
        categories: sortByPosition(cats.categories).map(toCategory),
        collections: sortByPosition(cols.collections).map(toCollection),
        restaurants: outlets
          .filter((o) => o.outlet)
          .map((o) => {
            const r = toRestaurant(o);
            return {
              id: r.id,
              name: r.name,
              category: r.category,
              rating: r.rating,
              etaMin: r.etaMin,
              hasOffer: r.hasOffer,
              imageId: r.imageId,
              area: r.area,
              status: r.status,
            };
          }),
        images: IMAGE_LIBRARY,
      };
    },
  );

  app.post(
    "/v1/content/categories/:id/move",
    {
      config: { permission: "content.edit" },
      schema: {
        operationId: "moveCategory",
        tags,
        security,
        summary: "Move a home category up (-1) or down (1) (catalog). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        body: Type.Object({ direction: Direction }),
        response: { 200: listOf(HomeCategory), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.merchandising,
        "moveHomeCategory",
        MoveHomeCategoryRequest.fromPartial({ id: req.params.id, direction: dir(req.body.direction) }),
      );
      const cats = sortByPosition(res.categories).map(toCategory);
      const i = cats.findIndex((c) => c.id === req.params.id);
      await ctx.audit({
        action: `Moved category ${req.body.direction < 0 ? "up" : "down"}`,
        recordType: "content",
        recordId: req.params.id,
        detail: i >= 0 ? `${cats[i]!.label} is now number ${i + 1}` : undefined,
      });
      return cats;
    },
  );

  app.patch(
    "/v1/content/categories/:id",
    {
      config: { permission: "content.edit" },
      schema: {
        operationId: "updateCategory",
        tags,
        security,
        summary: "Change a category's label, image or visibility (catalog). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        body: Type.Object({
          label: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
          imageId: Type.Optional(Type.String({ minLength: 1 })),
          visible: Type.Optional(Type.Boolean()),
        }),
        response: { 200: ref(HomeCategory), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const patch = req.body;
      const res = await ctx.rpc(
        ctx.up.merchandising,
        "updateHomeCategory",
        UpdateHomeCategoryRequest.fromPartial({ id: req.params.id, ...patch }),
      );
      const c = res.categories.find((x) => x.id === req.params.id);
      if (!c) throw notFound("Category");
      const action =
        patch.visible !== undefined
          ? patch.visible
            ? "Showed category"
            : "Hid category"
          : patch.label !== undefined
            ? "Renamed category"
            : "Changed category image";
      await ctx.audit({ action, recordType: "content", recordId: c.id, detail: c.label });
      return toCategory(c);
    },
  );

  app.post(
    "/v1/content/collections",
    {
      config: { permission: "content.edit" },
      schema: {
        operationId: "saveCollection",
        tags,
        security,
        summary: "Create (no id) or update a banner or shelf (catalog). Audited.",
        body: ref(SaveCollection),
        response: { 200: ref(Collection), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const input = req.body;
      if (!input.title.trim())
        throw badRequest("TITLE_REQUIRED", "Give the collection a title customers will see.");
      if (input.source === "handPicked" && input.restaurantIds.length < 2)
        throw badRequest(
          "TOO_FEW_RESTAURANTS",
          "Pick at least two restaurants for a hand-picked collection.",
        );
      if (input.endsOn && input.endsOn < input.startsOn)
        throw badRequest("DATES_REVERSED", "The end date is before the start date.");
      const rule = input.rule ?? {};
      const res = await ctx.rpc(
        ctx.up.merchandising,
        "saveCollection",
        SaveCollectionRequest.fromPartial({
          collection: {
            id: input.id ?? "",
            title: input.title.trim(),
            subtitle: input.subtitle,
            placement:
              input.placement === "banner"
                ? CollectionPlacement.COLLECTION_PLACEMENT_BANNER
                : CollectionPlacement.COLLECTION_PLACEMENT_SHELF,
            source:
              input.source === "rules"
                ? CollectionSource.COLLECTION_SOURCE_RULES
                : CollectionSource.COLLECTION_SOURCE_HAND_PICKED,
            rule:
              input.source === "rules"
                ? {
                    categoryId: rule.category ?? "",
                    minRating: rule.minRating ?? 0,
                    maxEtaMinutes: rule.maxEta ?? 0,
                    offersOnly: rule.offersOnly ?? false,
                  }
                : undefined,
            restaurantIds: input.restaurantIds.map(restaurantUuid),
            startsOn: input.startsOn,
            endsOn: input.endsOn ?? "",
            visible: input.visible,
          },
        }),
      );
      if (!res.collection) throw notFound("Collection");
      const saved = toCollection(res.collection);
      await ctx.audit({
        action: input.id ? "Changed collection" : "Created collection",
        recordType: "content",
        recordId: saved.id,
        detail: saved.title,
      });
      return saved;
    },
  );

  app.put(
    "/v1/content/collections/:id/visible",
    {
      config: { permission: "content.edit" },
      schema: {
        operationId: "setCollectionVisible",
        tags,
        security,
        summary: "Show or hide a collection (catalog). Audited.",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        body: Type.Object({ visible: Type.Boolean() }),
        response: { 200: ref(Collection), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.merchandising,
        "setCollectionVisible",
        SetCollectionVisibleRequest.fromPartial({ id: req.params.id, visible: req.body.visible }),
      );
      if (!res.collection) throw notFound("Collection");
      const c = toCollection(res.collection);
      await ctx.audit({
        action: c.visible ? "Showed collection" : "Hid collection",
        recordType: "content",
        recordId: c.id,
        detail: c.title,
      });
      return c;
    },
  );

  app.post(
    "/v1/content/collections/:id/move",
    {
      config: { permission: "content.edit" },
      schema: {
        operationId: "moveCollection",
        tags,
        security,
        summary: "Move a collection up (-1) or down (1) (catalog).",
        params: Type.Object({ id: Type.String({ minLength: 1 }) }),
        body: Type.Object({ direction: Direction }),
        response: { 200: listOf(Collection), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.merchandising,
        "moveCollection",
        MoveCollectionRequest.fromPartial({ id: req.params.id, direction: dir(req.body.direction) }),
      );
      return sortByPosition(res.collections).map(toCollection);
    },
  );
};
