// Integration test against the SHARED stack and a running catalog (localhost:50101, or CATALOG_GRPC):
// catalog -> outbox -> Debezium -> kade.restaurant.events / kade.menu.events -> this projection.
// The test restaurant is suspended at the end (through a merchant event, as catalog's own test does),
// which also removes it from search results.
import { credentials, Metadata, type Client, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import * as C from "@kade/proto/kade/catalog/v1/catalog_service";
import { OutletStatusChanged } from "@kade/proto/kade/merchant/v1/merchant_events";
import { OutletAdminStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import * as S from "@kade/proto/kade/search/v1/search_service";
import { sql } from "drizzle-orm";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { Backfill } from "../../src/search/backfill.js";
import { Projection } from "../../src/search/projection.js";
import { loadConfig } from "../../src/platform/config.js";
import { Database } from "../../src/platform/db/database.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const config = loadConfig({
  SERVICE_NAME: "search",
  DATABASE_URL: "postgres://search:search@localhost:15432/search",
  KAFKA_BROKERS: "localhost:19092",
  CATALOG_GRPC: "localhost:50101",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  PRICING_GRPC: undefined,
});

let app: INestApplication;
let search: S.SearchServiceClient;
let catalog: C.CatalogServiceClient;
let restaurants: C.RestaurantManagementServiceClient;
let menus: C.MenuManagementServiceClient;
let pool: pg.Pool;
let producer: KafkaJS.Producer;
const created: string[] = [];

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  search = new S.SearchServiceClient(`localhost:${app.get(GrpcServer).port}`, credentials.createInsecure());
  catalog = new C.CatalogServiceClient(config.CATALOG_GRPC!, credentials.createInsecure());
  restaurants = new C.RestaurantManagementServiceClient(config.CATALOG_GRPC!, credentials.createInsecure());
  menus = new C.MenuManagementServiceClient(config.CATALOG_GRPC!, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  const kafka = new KafkaJS.Kafka({
    kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR },
  });
  producer = kafka.producer();
  await producer.connect();
});

afterAll(async () => {
  for (const id of created) await suspend(id);
  await app?.get(Backfill).idle();
  for (const c of [search, catalog, restaurants, menus]) c?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

type Codec<T> = { fromPartial(p: unknown): T };
function call<Res>(client: Client, method: string, codec: Codec<unknown>, req: unknown): Promise<Res> {
  return new Promise((resolve, reject) =>
    (
      client as unknown as Record<
        string,
        (r: unknown, m: Metadata, o: object, cb: (e: ServiceError | null, r: Res) => void) => void
      >
    )[method]!(codec.fromPartial(req), new Metadata(), { deadline: Date.now() + 5_000 }, (err, res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}
const find = (query: string) => call<S.SearchResponse>(search, "search", S.SearchRequest, { query });

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 45_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function suspend(outletId: string): Promise<void> {
  const value = OutletStatusChanged.encode(
    OutletStatusChanged.fromPartial({
      outletId,
      status: { adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED },
    }),
  ).finish();
  await producer.send({
    topic: "kade.merchant.events",
    messages: [
      {
        key: outletId,
        value: Buffer.from(value),
        headers: { id: uuidv7(), eventType: "kade.merchant.v1.OutletStatusChanged" },
      },
    ],
  });
}

/** A word nothing else in the catalogue contains. */
const token = () =>
  `zq${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, "")
    .slice(0, 6)}`;

describe("projection from catalog events", () => {
  it("indexes a new restaurant and dish, then follows sold-out and suspension", async () => {
    const word = token();
    const rid = uuidv7();
    created.push(rid);
    await call(restaurants, "createRestaurant", C.CreateRestaurantRequest, {
      restaurantId: rid,
      details: {
        name: `IT Search ${word}`,
        categoryId: "kottu",
        cuisine: "Kottu",
        area: "Kollupitiya",
        location: { lat: 6.91, lng: 79.852 },
      },
    });
    const { menu } = await call<C.CreateMenuSectionResponse>(
      menus,
      "createMenuSection",
      C.CreateMenuSectionRequest,
      { restaurantId: rid, name: "Kottu" },
    );
    const saved = await call<C.SaveMenuItemResponse>(menus, "saveMenuItem", C.SaveMenuItemRequest, {
      restaurantId: rid,
      item: {
        sectionId: menu!.sections[0]!.id,
        name: `${word} buns`,
        description: "Spicy",
        price: { amountMinor: 50_000, currency: "LKR" },
      },
    });

    // Stemmed prefix match: "<word> bun" finds "<word> buns"; the restaurant is found by its name.
    const hit = await eventually(async () => {
      const res = await find(`${word} bun`);
      return res.dishes[0];
    });
    expect(hit.item).toMatchObject({
      id: saved.item!.id,
      name: `${word} buns`,
      soldOut: false,
      price: { amountMinor: 50_000 },
    });
    expect(hit.restaurant?.name).toBe(`IT Search ${word}`);
    expect((await find(word)).restaurants.map((r) => r.id)).toEqual([rid]);

    await call(menus, "setMenuItemSoldOut", C.SetMenuItemSoldOutRequest, {
      restaurantId: rid,
      itemId: saved.item!.id,
      soldOut: true,
    });
    await eventually(async () => ((await find(word)).dishes[0]?.item?.soldOut ? true : undefined));

    await suspend(rid);
    await eventually(async () => {
      const res = await find(word);
      return res.restaurants.length === 0 && res.dishes.length === 0 ? true : undefined;
    });
  });

  it("ignores stale snapshots and menu versions", async () => {
    const projection = app.get(Projection);
    const database = app.get(Database);
    const id = uuidv7();
    const restaurant = C.Restaurant.fromPartial({ id, name: "Stale test", categoryId: "kottu" });
    await database.transaction(undefined, async (tx) => {
      await projection.upsertRestaurant(tx, { ...restaurant, name: "Newer" }, new Date(2_000));
      await projection.upsertRestaurant(tx, { ...restaurant, name: "Older" }, new Date(1_000));
      expect(await projection.replaceMenu(tx, C.Menu.fromPartial({ restaurantId: id, version: 5 }))).toBe(
        true,
      );
      expect(await projection.replaceMenu(tx, C.Menu.fromPartial({ restaurantId: id, version: 4 }))).toBe(
        false,
      );
      const { rows } = await tx.execute<{ name: string; menu_version: string }>(
        sql`select name, menu_version from search_restaurants where id = ${id}`,
      );
      expect(rows[0]).toMatchObject({ name: "newer", menu_version: "5" });
      await tx.execute(sql`delete from search_restaurants where id = ${id}`);
    });
  });
});

describe("seeded catalogue", () => {
  it("finds the mock's dishes and restaurants, with typo tolerance", async () => {
    const kottu = await find("kottu");
    expect(kottu.restaurants.map((r) => r.name)).toContain("Galle Road Kottu House");
    expect(kottu.dishes.map((d) => d.item?.name)).toContain("Cheese kottu");
    const typo = await find("biriyani");
    expect(typo.dishes.map((d) => d.item?.name)).toContain("Chicken biryani");
    expect((await find("")).dishes).toEqual([]);
  });

  it("rebuilds the index from catalog", async () => {
    await call(search, "rebuildIndex", S.RebuildIndexRequest, {});
    await app.get(Backfill).idle();
    const res = await find("watalappan");
    expect(res.restaurants.map((r) => r.name)).toContain("Watalappan Bar");
    const { rows } = await pool.query(
      "select count(*)::int n from search_restaurants where snapshot is not null",
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(16);
  });
});

describe("places and suggestions", () => {
  it("serves the address picker and popular searches", async () => {
    const places = await call<S.SearchPlacesResponse>(search, "searchPlaces", S.SearchPlacesRequest, {
      query: "galle",
    });
    expect(places.places[0]).toMatchObject({ id: "galle-face", inZone: true, zoneId: "c03" });
    const nearest = await call<S.ReverseGeocodeResponse>(search, "reverseGeocode", S.ReverseGeocodeRequest, {
      location: { lat: 6.8564, lng: 79.8633 },
    });
    expect(nearest.place?.area).toBe("Dehiwala");
    const popular = await call<S.ListPopularSearchesResponse>(
      search,
      "listPopularSearches",
      S.ListPopularSearchesRequest,
      {},
    );
    expect(popular.queries).toEqual([
      "Kottu",
      "Biryani",
      "Fish buns",
      "Watalappan",
      "Ramen",
      "Rice and curry",
      "Eggs",
    ]);
  });
});
