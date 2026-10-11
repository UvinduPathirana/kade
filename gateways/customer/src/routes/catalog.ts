import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { toCategory, toMenu, toMenuItem, toPlace, toRestaurant, toReview } from "../mappers/catalog.js";
import { geoFromMap } from "../mappers/geo.js";
import { fromMode } from "../mappers/orders.js";
import {
  Category,
  Menu,
  Place,
  Restaurant,
  Review,
  SearchResults,
  problems,
  ref,
  refAs,
  type Menu as MenuT,
  type SearchResults as SearchResultsT,
} from "../schemas.js";
import { httpError, restaurantIdOr404, type RouteDeps } from "./context.js";

/** The home rail's first chip; the catalog only knows real categories. */
const ALL: Category = { id: "all", label: "All", imageId: "1504674900247-0877df9cc836" };

const Where = Type.Object({
  x: Type.Optional(Type.Number({ description: "Delivery pin, map units." })),
  y: Type.Optional(Type.Number({ description: "Delivery pin, map units." })),
});
const deliverTo = (q: { x?: number; y?: number }) =>
  q.x !== undefined && q.y !== undefined ? geoFromMap({ x: q.x, y: q.y }) : undefined;

const RestaurantParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });

export const catalogRoutes =
  ({ up, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    /** Restaurants this customer has ordered from: the "ordered before" badge. Best effort. */
    async function orderedBefore(req: FastifyRequest, reply: FastifyReply): Promise<Set<string>> {
      if (!req.identity) return new Set();
      try {
        const res = await unary(
          up.order.listOrders.bind(up.order),
          {
            customerId: req.identity.userId,
            restaurantId: "",
            riderId: "",
            zoneId: "",
            statuses: [],
            lateOnly: false,
            activeOnly: false,
            query: "",
            oldestFirst: false,
            page: { pageSize: 100, pageToken: "" },
          },
          callContext(req, reply),
        );
        return new Set(res.orders.map((o) => o.restaurant?.id ?? ""));
      } catch (err) {
        req.log.warn({ err }, "ordered-before lookup failed; showing restaurants without it");
        return new Set();
      }
    }

    app.get(
      "/v1/categories",
      {
        config: { auth: "public" },
        schema: {
          operationId: "listCategories",
          tags: ["catalog"],
          summary: 'Food categories for the home rail ("All" first)',
          response: { 200: Type.Array(ref(Category)), ...problems(503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(up.catalog.listCategories.bind(up.catalog), {}, callContext(req, reply));
        const cats = res.categories.filter((c) => c.visible !== false).map(toCategory);
        return cats.some((c) => c.id === ALL.id) ? cats : [ALL, ...cats];
      },
    );

    app.get(
      "/v1/categories/:id",
      {
        config: { auth: "public" },
        schema: {
          operationId: "getCategory",
          tags: ["catalog"],
          params: Type.Object({ id: Type.String({ maxLength: 64 }) }),
          response: { 200: ref(Category), ...problems(404, 503, 504) },
        },
      },
      async (req, reply) => {
        if (req.params.id === ALL.id)
          throw httpError(404, "CATEGORY_NOT_FOUND", "We couldn't find that category.");
        const res = await unary(
          up.catalog.getCategory.bind(up.catalog),
          { id: req.params.id },
          callContext(req, reply),
        );
        if (!res.category) throw httpError(404, "CATEGORY_NOT_FOUND", "We couldn't find that category.");
        return toCategory(res.category);
      },
    );

    app.get(
      "/v1/restaurants",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "listRestaurants",
          tags: ["catalog"],
          summary: "Every restaurant, open ones first; fee/ETA for the delivery pin when given",
          querystring: Type.Object({
            ...Where.properties,
            mode: Type.Optional(Type.Union([Type.Literal("delivery"), Type.Literal("pickup")])),
          }),
          response: { 200: Type.Array(ref(Restaurant)), ...problems(503, 504) },
        },
      },
      async (req, reply) => {
        const [res, before] = await Promise.all([
          unary(
            up.catalog.listRestaurants.bind(up.catalog),
            {
              deliverTo: deliverTo(req.query),
              mode: fromMode(req.query.mode ?? "delivery"),
              categoryId: "",
              openOnly: false,
              offersOnly: false,
              vegetarianOnly: false,
              ids: [],
              page: { pageSize: 200, pageToken: "" },
            },
            callContext(req, reply),
          ),
          orderedBefore(req, reply),
        ]);
        return res.restaurants.map((r) => toRestaurant(r, before));
      },
    );

    app.get(
      "/v1/restaurants/:id",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "getRestaurant",
          tags: ["catalog"],
          params: RestaurantParams,
          querystring: Where,
          response: { 200: ref(Restaurant), ...problems(404, 503, 504) },
        },
      },
      async (req, reply) => {
        const id = restaurantIdOr404(req.params.id);
        const [res, before] = await Promise.all([
          unary(
            up.catalog.getRestaurant.bind(up.catalog),
            { id, deliverTo: deliverTo(req.query) },
            callContext(req, reply),
          ),
          orderedBefore(req, reply),
        ]);
        if (!res.restaurant)
          throw httpError(404, "RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");
        return toRestaurant(res.restaurant, before);
      },
    );

    app.get(
      "/v1/restaurants/:id/menu",
      {
        config: { auth: "public" },
        schema: {
          operationId: "getMenu",
          tags: ["catalog"],
          params: RestaurantParams,
          response: { 200: refAs<MenuT>(Menu), ...problems(404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.catalog.getMenu.bind(up.catalog),
          { restaurantId: restaurantIdOr404(req.params.id) },
          callContext(req, reply),
        );
        if (!res.menu) throw httpError(404, "RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");
        return toMenu(res.menu);
      },
    );

    app.get(
      "/v1/restaurants/:id/reviews",
      {
        config: { auth: "public" },
        schema: {
          operationId: "listReviews",
          tags: ["catalog"],
          params: RestaurantParams,
          response: { 200: Type.Array(ref(Review)), ...problems(404, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.review.listRestaurantReviews.bind(up.review),
          {
            restaurantId: restaurantIdOr404(req.params.id),
            withTextOnly: true,
            unrepliedOnly: false,
            maxStars: 0,
            page: { pageSize: 20, pageToken: "" },
          },
          callContext(req, reply),
        );
        const now = Date.now();
        return res.reviews.map((r) => toReview(r, now));
      },
    );

    app.get(
      "/v1/search",
      {
        config: { auth: "public" },
        schema: {
          operationId: "search",
          tags: ["catalog"],
          summary: "Dishes and restaurants matching every word of the query",
          querystring: Type.Object({ q: Type.String({ maxLength: 200 }), ...Where.properties }),
          response: { 200: refAs<SearchResultsT>(SearchResults), ...problems(400, 503, 504) },
        },
      },
      async (req, reply): Promise<SearchResultsT> => {
        const query = req.query.q;
        if (!query.trim()) return { query, dishes: [], restaurants: [] };
        const res = await unary(
          up.search.search.bind(up.search),
          { query, deliverTo: deliverTo(req.query), maxDishes: 40, page: undefined },
          callContext(req, reply),
        );
        return {
          query,
          dishes: res.dishes.flatMap((d) =>
            d.item && d.restaurant
              ? [{ item: toMenuItem(d.item), restaurant: toRestaurant(d.restaurant) }]
              : [],
          ),
          restaurants: res.restaurants.map((r) => toRestaurant(r)),
        };
      },
    );

    app.get(
      "/v1/search/popular",
      {
        config: { auth: "public" },
        schema: {
          operationId: "listPopularSearches",
          tags: ["catalog"],
          response: { 200: Type.Array(Type.String()), ...problems(503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(up.search.listPopularSearches.bind(up.search), {}, callContext(req, reply));
        return res.queries;
      },
    );

    app.get(
      "/v1/places",
      {
        config: { auth: "public" },
        schema: {
          operationId: "searchPlaces",
          tags: ["catalog"],
          summary: "Address picker: places matching the query, in or out of the delivery zone",
          querystring: Type.Object({ q: Type.String({ maxLength: 120 }) }),
          response: { 200: Type.Array(ref(Place)), ...problems(503, 504) },
        },
      },
      async (req, reply) => {
        if (req.query.q.trim().length < 2) return [];
        const res = await unary(
          up.search.searchPlaces.bind(up.search),
          { query: req.query.q, limit: 6 },
          callContext(req, reply),
        );
        return res.places.map(toPlace);
      },
    );
  };
