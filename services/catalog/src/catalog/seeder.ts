import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { CollectionPlacement, CollectionSource, DishTag } from "@kade/proto/kade/catalog/v1/catalog_service";
import { RestaurantKind } from "@kade/proto/kade/catalog/v1/catalog_service";
import { sql } from "drizzle-orm";
import {
  categories,
  closures,
  collections,
  menuItems,
  menuSections,
  optionGroups,
  restaurants,
  seedRuns,
  type HoursDay,
} from "../db/schema.js";
import { CONFIG, type Config } from "../platform/config.js";
import { Database, type Tx } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { CLOCK, type Clock } from "./access.js";
import { CatalogEvents } from "./events.js";
import { bearing, destination, fromMapUnits } from "./geo.js";
import { parseHoursLabel } from "./hours.js";
import {
  collectionId,
  menuItemId,
  menuSectionId,
  optionChoiceId,
  optionGroupId,
  restaurantId,
} from "./ids.js";
import { slugify, toMenu } from "./model.js";
import {
  menuTemplates,
  OPTION_GROUP_ORDER,
  REFERENCE_PIN,
  restaurantOneClosures,
  restaurantOneHours,
  seedCategories,
  seedCollections,
  seedOptionGroups,
  seedRestaurants,
  type SeedRestaurant,
} from "./seed-data.js";
import { CatalogStore } from "./store.js";

/** Bump when the seed changes in a way existing databases should pick up (rows are upserted by id). */
export const SEED_VERSION = 1;
const SEED_LOCK = 72_616_402;
const rupees = (n: number): number => n * 100;
const TAGS = { Vegetarian: DishTag.DISH_TAG_VEGETARIAN, Spicy: DishTag.DISH_TAG_SPICY } as const;

/**
 * Seeds the customer app's mock catalogue once per SEED_VERSION, with deterministic ids, and
 * publishes RestaurantCreated / RestaurantHoursChanged / MenuUpdated for every restaurant through
 * the outbox so search (and anyone else) can build projections from the topics.
 * Runs on bootstrap, i.e. after every module's onModuleInit, so migrations have been applied.
 */
@Injectable()
export class Seeder implements OnApplicationBootstrap {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(CatalogEvents) private readonly events: CatalogEvents,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.SEED_ON_START) return;
    const applied = await this.seed();
    if (applied)
      this.logger.info({ version: SEED_VERSION, restaurants: seedRestaurants.length }, "catalog seeded");
  }

  /** Returns false when this seed version was already applied. */
  async seed(): Promise<boolean> {
    return this.database.transaction(undefined, async (tx) => {
      // Two replicas starting together: one seeds, the other waits and then sees the marker.
      await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
      const done = await tx
        .select()
        .from(seedRuns)
        .where(sql`${seedRuns.version} = ${SEED_VERSION}`);
      if (done.length > 0) return false;
      await this.seedCategories(tx);
      for (const r of seedRestaurants) await this.seedRestaurant(tx, r);
      await this.seedCollections(tx);
      await tx.insert(seedRuns).values({ version: SEED_VERSION });
      return true;
    });
  }

  private async seedCategories(tx: Tx): Promise<void> {
    await tx
      .insert(categories)
      .values(seedCategories.map((c, position) => ({ ...c, visible: true, position })))
      .onConflictDoNothing();
  }

  private async seedRestaurant(tx: Tx, r: SeedRestaurant): Promise<void> {
    const id = restaurantId(r.id);
    const now = this.clock();
    const { lat, lng } = placeRestaurant(r);
    const hours: HoursDay[] =
      r.id === 1
        ? restaurantOneHours
        : [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, isOpen: true, ranges: [parseHoursLabel(r.hours)] }));

    await tx
      .insert(restaurants)
      .values({
        id,
        legacyId: r.id,
        slug: slugify(r.name),
        name: r.name,
        kind:
          r.categoryId === "grocery"
            ? RestaurantKind.RESTAURANT_KIND_SHOP
            : RestaurantKind.RESTAURANT_KIND_RESTAURANT,
        categoryId: r.categoryId,
        cuisine: r.cuisine,
        imageId: r.imageId,
        etaMinMinutes: r.eta[0],
        etaMaxMinutes: r.eta[1],
        baseDeliveryFeeMinor: rupees(r.deliveryFee),
        rating: r.rating,
        ratingCount: r.ratingCount,
        priceLevel: r.priceLevel,
        offerLabel: r.offer ?? "",
        discountPercent: r.discountPercent ?? 0,
        // Free delivery in the mock = a running free-delivery offer, so pricing also quotes Rs 0.
        freeDeliveryOffer: r.deliveryFee === 0,
        hasVegetarian: r.hasVegetarian,
        area: r.area,
        address: r.address,
        phone: r.phone,
        lat,
        lng,
        zoneId: r.zoneId,
        hours,
      })
      .onConflictDoNothing();

    if (r.id === 1) {
      await tx
        .insert(closures)
        .values(
          restaurantOneClosures.map((c) => ({
            id: `00000000-0000-7000-8015-${String(c.n).padStart(12, "0")}`,
            restaurantId: id,
            date: c.date,
            reason: c.reason,
          })),
        )
        .onConflictDoNothing();
    }

    await this.seedMenu(tx, r);

    const row = (await this.store.findRestaurant(tx, id))!;
    const closureRows = await this.store.closuresOf(tx, id);
    await this.events.restaurantCreated(tx, row, closureRows, now);
    await this.events.hoursChanged(tx, row, closureRows);
    await this.events.menuUpdated(tx, toMenu(await this.store.menuRows(tx, row), now));
  }

  private async seedMenu(tx: Tx, r: SeedRestaurant): Promise<void> {
    const rid = restaurantId(r.id);
    const template = menuTemplates[r.categoryId] ?? menuTemplates.rice!;
    const used = new Set(template.flatMap(([, items]) => items.flatMap((i) => i.options ?? [])));
    const groupIds = new Map(OPTION_GROUP_ORDER.map((key, g) => [key, optionGroupId(r.id, g + 1)]));

    const groups = OPTION_GROUP_ORDER.flatMap((key, g) => {
      if (!used.has(key)) return [];
      const def = seedOptionGroups[key];
      return [
        {
          id: groupIds.get(key)!,
          restaurantId: rid,
          slug: key,
          name: def.name,
          required: def.required,
          maxChoices: def.max,
          position: g,
          choices: def.choices.map(([name, price], c) => ({
            id: optionChoiceId(r.id, g + 1, c + 1),
            name,
            priceMinor: rupees(price),
          })),
        },
      ];
    });
    if (groups.length) await tx.insert(optionGroups).values(groups).onConflictDoNothing();

    await tx
      .insert(menuSections)
      .values(
        template.map(([name], s) => ({ id: menuSectionId(r.id, s), restaurantId: rid, name, position: s })),
      )
      .onConflictDoNothing();

    const items = template.flatMap(([, seeds], s) =>
      seeds.map((seed, i) => ({
        id: menuItemId(r.id, s, i),
        restaurantId: rid,
        sectionId: menuSectionId(r.id, s),
        name: seed.name,
        description: seed.description,
        priceMinor: rupees(seed.price),
        imageId: seed.imageId ?? "",
        tags: (seed.tags ?? []).map((t) => TAGS[t]),
        optionGroupIds: (seed.options ?? []).map((o) => groupIds.get(o)!),
        popularRank: seed.popularRank ?? 0,
        soldOut: seed.soldOut ?? false,
        unit: seed.unit ?? "",
        position: i,
        legacyId: `${r.id}-${s}-${i}`,
      })),
    );
    await tx.insert(menuItems).values(items).onConflictDoNothing();
  }

  private async seedCollections(tx: Tx): Promise<void> {
    await tx
      .insert(collections)
      .values(
        seedCollections.map((c, position) => ({
          id: collectionId(c.n),
          title: c.title,
          subtitle: c.subtitle,
          placement:
            c.placement === "banner"
              ? CollectionPlacement.COLLECTION_PLACEMENT_BANNER
              : CollectionPlacement.COLLECTION_PLACEMENT_SHELF,
          source:
            c.source === "rules"
              ? CollectionSource.COLLECTION_SOURCE_RULES
              : CollectionSource.COLLECTION_SOURCE_HAND_PICKED,
          rule: c.rule ?? {},
          restaurantIds: c.restaurants.map(restaurantId),
          startsOn: c.startsOn,
          endsOn: c.endsOn ?? "",
          visible: true,
          position,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Real-ish coordinates: from the customer's Home address, towards the restaurant's area, at exactly
 * the mock's distance, so a listing for Home shows the same "1.2 km" the app showed.
 */
export function placeRestaurant(r: Pick<SeedRestaurant, "towards" | "distanceKm">): {
  lat: number;
  lng: number;
} {
  const home = fromMapUnits(...REFERENCE_PIN);
  const target = fromMapUnits(...r.towards);
  const p = destination(home, bearing(home, target), r.distanceKm);
  return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
}

/** Home (42 Galle Rd, Colombo 03) as a GeoPoint: pass it as deliver_to to reproduce the mock distances. */
export const REFERENCE_LOCATION = fromMapUnits(...REFERENCE_PIN);
