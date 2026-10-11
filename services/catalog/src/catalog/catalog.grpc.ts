import { Inject, Injectable } from "@nestjs/common";
import {
  CatalogServiceService,
  CollectionPlacement,
  CollectionSource,
  LineProblem,
  RestaurantProblem,
  AvailabilityState,
  type BatchGetRestaurantsRequest,
  type BatchGetRestaurantsResponse,
  type GetCategoryRequest,
  type GetCategoryResponse,
  type GetHomeFeedRequest,
  type GetHomeFeedResponse,
  type GetMenuRequest,
  type GetMenuResponse,
  type GetRestaurantRequest,
  type GetRestaurantResponse,
  type HomeCollection,
  type ListCategoriesResponse,
  type ListRestaurantsRequest,
  type ListRestaurantsResponse,
  type ValidateCartRequest,
  type ValidateCartResponse,
  type ValidatedLine,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import type { PageRequest, PageResponse } from "@kade/proto/kade/common/v1/types";
import { Database } from "../platform/db/database.js";
import { invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { CLOCK, type Clock } from "./access.js";
import { colomboParts } from "./hours.js";
import { parseRestaurantRef } from "./ids.js";
import {
  availabilityOf,
  collectionLive,
  isSoldOut,
  LKR,
  matchesRule,
  toCategory,
  toCollection,
  toMenu,
  type ItemRow,
  type OptionGroupRow,
  type RestaurantRow,
} from "./model.js";
import { feedOrder, isOpen, isSuspended, RestaurantViews } from "./restaurant-views.js";
import { CatalogStore } from "./store.js";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const MAX_QTY = 99;

/** kade.catalog.v1.CatalogService: the customer app's reads, and ValidateCart for the order saga. */
@GrpcService(CatalogServiceService)
@Injectable()
export class CatalogGrpcService implements GrpcHandlers<CatalogServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(RestaurantViews) private readonly views: RestaurantViews,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listCategories(): Promise<ListCategoriesResponse> {
    const rows = await this.store.categories(this.database.db);
    return { categories: rows.filter((c) => c.visible).map(toCategory) };
  }

  async getCategory(request: GetCategoryRequest): Promise<GetCategoryResponse> {
    const rows = await this.store.categories(this.database.db);
    // "all" is the rail's catch-all chip, not a category page (same as the app's mock).
    const row = rows.find((c) => c.id === request.id && c.id !== "all");
    if (!row) throw notFound("CATEGORY_NOT_FOUND", "We couldn't find that category.", { id: request.id });
    return { category: toCategory(row) };
  }

  async listRestaurants(request: ListRestaurantsRequest): Promise<ListRestaurantsResponse> {
    const ids = request.ids.length ? resolveIds(request.ids) : undefined;
    const db = this.database.db;
    const rows = await this.store.listRestaurants(db, {
      categoryId: request.categoryId && request.categoryId !== "all" ? request.categoryId : undefined,
      vegetarianOnly: request.vegetarianOnly,
      offersOnly: request.offersOnly,
      ids: ids?.uuids,
    });
    const extra = ids?.legacy.length
      ? (await this.store.listRestaurants(db)).filter((r) => ids.legacy.includes(r.legacyId))
      : [];
    const views = await this.views.build(
      db,
      [...rows, ...extra.filter((e) => !rows.some((r) => r.id === e.id))],
      {
        deliverTo: request.deliverTo,
        mode: request.mode,
      },
    );
    const list = views
      .filter((v) => !v.outOfZone)
      .map((v) => v.restaurant)
      // Suspended restaurants are hidden from the feed; an explicit id lookup still sees them.
      .filter((r) => ids !== undefined || !isSuspended(r))
      .filter((r) => !request.openOnly || isOpen(r))
      .sort(feedOrder);
    const { slice, page } = paginate(list, request.page);
    return { restaurants: slice, page };
  }

  async getRestaurant(request: GetRestaurantRequest): Promise<GetRestaurantResponse> {
    const db = this.database.db;
    const row = await this.store.requireRestaurant(db, request.id);
    const [view] = await this.views.build(db, [row], { deliverTo: request.deliverTo });
    return { restaurant: view!.restaurant };
  }

  async batchGetRestaurants(request: BatchGetRestaurantsRequest): Promise<BatchGetRestaurantsResponse> {
    const db = this.database.db;
    const found: RestaurantRow[] = [];
    for (const ref of request.ids) {
      const row = await this.store.findRestaurant(db, ref);
      if (row && !found.some((r) => r.id === row.id)) found.push(row);
    }
    const views = await this.views.build(db, found, { deliverTo: request.deliverTo });
    return { restaurants: views.map((v) => v.restaurant) };
  }

  async getMenu(request: GetMenuRequest): Promise<GetMenuResponse> {
    const db = this.database.db;
    const row = await this.store.requireRestaurant(db, request.restaurantId);
    return { menu: toMenu(await this.store.menuRows(db, row), this.clock()) };
  }

  async getHomeFeed(request: GetHomeFeedRequest): Promise<GetHomeFeedResponse> {
    const db = this.database.db;
    const [categoryRows, collectionRows, restaurantRows] = await Promise.all([
      this.store.categories(db),
      this.store.collections(db),
      this.store.listRestaurants(db),
    ]);
    const views = await this.views.build(db, restaurantRows, { deliverTo: request.deliverTo });
    const visible = views.filter((v) => !v.outOfZone && !isSuspended(v.restaurant)).map((v) => v.restaurant);
    const byId = new Map(visible.map((r) => [r.id, r]));
    const ordered = [...visible].sort(feedOrder);
    const today = colomboParts(this.clock()).date;

    const banners: HomeCollection[] = [];
    const shelves: HomeCollection[] = [];
    for (const row of collectionRows) {
      if (!collectionLive(row, today)) continue;
      const restaurants =
        row.source === CollectionSource.COLLECTION_SOURCE_HAND_PICKED
          ? row.restaurantIds.flatMap((id) => byId.get(id) ?? [])
          : ordered.filter((r) => matchesRule(r, row.rule));
      if (restaurants.length === 0) continue;
      const entry = { collection: toCollection(row), restaurants };
      if (row.placement === CollectionPlacement.COLLECTION_PLACEMENT_BANNER) banners.push(entry);
      else shelves.push(entry);
    }
    return { categories: categoryRows.filter((c) => c.visible).map(toCategory), banners, shelves };
  }

  async validateCart(request: ValidateCartRequest): Promise<ValidateCartResponse> {
    const db = this.database.db;
    const now = this.clock();
    const row = parseRestaurantRef(request.restaurantId)
      ? await this.store.findRestaurant(db, request.restaurantId)
      : undefined;
    if (!row) {
      return {
        ok: false,
        restaurant: undefined,
        lines: [],
        restaurantProblem: RestaurantProblem.RESTAURANT_PROBLEM_NOT_FOUND,
        restaurantProblemMessage: "This restaurant isn't on Kadé any more.",
        menuVersion: 0,
      };
    }
    const closures = await this.store.closuresOf(db, row.id);
    const fulfilAt = request.fulfilAt && request.fulfilAt.getTime() > now.getTime() ? request.fulfilAt : now;
    const [view] = await this.views.build(db, [row], { deliverTo: request.deliverTo, mode: request.mode });
    const restaurant = view!.restaurant;
    // Availability at the time the kitchen would start (scheduled orders look ahead).
    const at = availabilityOf(row, closures, fulfilAt);
    const restaurantCheck = restaurantProblem(row.name, at.state, at.closedLabel);

    const menu = await this.store.menuRows(db, row);
    const items = new Map(menu.items.map((i) => [i.id, i]));
    const groups = new Map(menu.groups.map((g) => [g.id, g]));
    const lines = request.lines.map((line) => validateLine(line, items, groups, menu.groups, now));

    const ok =
      restaurantCheck.problem === RestaurantProblem.RESTAURANT_PROBLEM_UNSPECIFIED &&
      lines.length > 0 &&
      lines.every((l) => l.problem === LineProblem.LINE_PROBLEM_UNSPECIFIED);
    return {
      ok,
      restaurant,
      lines,
      restaurantProblem: restaurantCheck.problem,
      restaurantProblemMessage: restaurantCheck.message,
      menuVersion: row.menuVersion,
    };
  }
}

function restaurantProblem(
  name: string,
  state: AvailabilityState,
  label: string,
): { problem: RestaurantProblem; message: string } {
  switch (state) {
    case AvailabilityState.AVAILABILITY_STATE_SUSPENDED:
      return {
        problem: RestaurantProblem.RESTAURANT_PROBLEM_SUSPENDED,
        message: `${name} isn't taking orders right now.`,
      };
    case AvailabilityState.AVAILABILITY_STATE_PAUSED:
      return {
        problem: RestaurantProblem.RESTAURANT_PROBLEM_PAUSED,
        message: `${name} isn't taking orders right now.${label ? ` ${label}.` : ""}`,
      };
    case AvailabilityState.AVAILABILITY_STATE_CLOSED:
      return {
        problem: RestaurantProblem.RESTAURANT_PROBLEM_CLOSED,
        message: `${name} is closed.${label ? ` ${label}.` : ""}`,
      };
    default:
      return { problem: RestaurantProblem.RESTAURANT_PROBLEM_UNSPECIFIED, message: "" };
  }
}

/** Checks one cart line against the live menu and prices it (item + paid options). */
export function validateLine(
  line: ValidateCartRequest["lines"][number],
  items: Map<string, ItemRow>,
  groups: Map<string, OptionGroupRow>,
  groupOrder: OptionGroupRow[],
  now: Date,
): ValidatedLine {
  const base: ValidatedLine = {
    lineKey: line.lineKey,
    itemId: line.itemId,
    name: "",
    unitPrice: LKR(0),
    quantity: line.quantity,
    choiceNames: [],
    sectionId: "",
    problem: LineProblem.LINE_PROBLEM_UNSPECIFIED,
    problemMessage: "",
  };
  const item = items.get(line.itemId.toLowerCase());
  if (!item) {
    return {
      ...base,
      problem: LineProblem.LINE_PROBLEM_ITEM_NOT_FOUND,
      problemMessage: "This dish is no longer on the menu.",
    };
  }
  const named = { ...base, itemId: item.id, name: item.name, sectionId: item.sectionId };
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) {
    return {
      ...named,
      unitPrice: LKR(item.priceMinor),
      problem: LineProblem.LINE_PROBLEM_QUANTITY_INVALID,
      problemMessage: `Choose between 1 and ${MAX_QTY}.`,
    };
  }
  if (isSoldOut(item, now)) {
    return {
      ...named,
      unitPrice: LKR(item.priceMinor),
      problem: LineProblem.LINE_PROBLEM_SOLD_OUT,
      problemMessage: `${item.name} is sold out.`,
    };
  }

  // Resolve selections. Gateways may send the app's choice names instead of ids; both work.
  const chosen = new Map<string, Set<string>>(); // group id -> choice ids
  for (const sel of line.options) {
    const group =
      groups.get(sel.optionGroupId.toLowerCase()) ??
      [...groups.values()].find((g) => g.slug === sel.optionGroupId || g.name === sel.optionGroupId);
    const choice = group?.choices.find(
      (c) => c.id === sel.choiceId.toLowerCase() || c.name.toLowerCase() === sel.choiceId.toLowerCase(),
    );
    if (!group || !choice || !item.optionGroupIds.includes(group.id)) {
      return {
        ...named,
        unitPrice: LKR(item.priceMinor),
        problem: LineProblem.LINE_PROBLEM_OPTION_INVALID,
        problemMessage: "One of the options you chose isn't available any more.",
      };
    }
    const set = chosen.get(group.id) ?? new Set<string>();
    set.add(choice.id);
    chosen.set(group.id, set);
  }

  let unit = item.priceMinor;
  const choiceNames: string[] = [];
  for (const group of groupOrder) {
    if (!item.optionGroupIds.includes(group.id)) continue;
    const picked = chosen.get(group.id) ?? new Set<string>();
    if (group.required && picked.size === 0) {
      return {
        ...named,
        unitPrice: LKR(item.priceMinor),
        problem: LineProblem.LINE_PROBLEM_REQUIRED_OPTION_MISSING,
        problemMessage: `Choose a ${group.name.toLowerCase()} for ${item.name}.`,
      };
    }
    if (picked.size > group.maxChoices) {
      return {
        ...named,
        unitPrice: LKR(item.priceMinor),
        problem: LineProblem.LINE_PROBLEM_TOO_MANY_CHOICES,
        problemMessage: `Choose up to ${group.maxChoices} for ${group.name.toLowerCase()}.`,
      };
    }
    for (const c of group.choices) {
      if (!picked.has(c.id)) continue;
      unit += c.priceMinor;
      choiceNames.push(c.name);
    }
  }
  return { ...named, unitPrice: LKR(unit), choiceNames };
}

function resolveIds(refs: string[]): { uuids: string[]; legacy: number[] } {
  const uuids: string[] = [];
  const legacy: number[] = [];
  for (const ref of refs) {
    const parsed = parseRestaurantRef(ref);
    if (!parsed) throw invalidArgument("RESTAURANT_ID_INVALID", "Restaurant ids must be UUIDs.", { id: ref });
    if ("id" in parsed) uuids.push(parsed.id);
    else legacy.push(parsed.legacyId);
  }
  return { uuids, legacy };
}

/** Offset pagination with an opaque token. */
export function paginate<T>(list: T[], page: PageRequest | undefined): { slice: T[]; page: PageResponse } {
  const size = Math.min(MAX_PAGE, page?.pageSize && page.pageSize > 0 ? page.pageSize : DEFAULT_PAGE);
  let offset = 0;
  if (page?.pageToken) {
    const raw = Buffer.from(page.pageToken, "base64url").toString("utf8");
    const decoded = Number(raw);
    if (!/^\d{1,9}$/.test(raw)) {
      throw invalidArgument("PAGE_TOKEN_INVALID", "That page token isn't valid.", {
        field: "page.page_token",
      });
    }
    offset = decoded;
  }
  const slice = list.slice(offset, offset + size);
  const next = offset + size < list.length ? Buffer.from(String(offset + size)).toString("base64url") : "";
  return { slice, page: { nextPageToken: next, totalSize: list.length } };
}
