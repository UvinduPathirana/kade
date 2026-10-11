// Integration test against the SHARED stack (pnpm infra:up): Postgres catalog, Kafka and the
// Debezium connector outbox-catalog (deploy/compose/connect/register-outbox.sh catalog catalog).
// Override addresses with DATABASE_URL / KAFKA_BROKERS when your host ports differ.
//
// Restaurants created here get a random UUID and are suspended in afterAll (via a merchant event),
// so they never show up in the customer feed or in search.
import { credentials, Metadata, status, type Client, type ServiceError } from "@grpc/grpc-js";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import type { INestApplication } from "@nestjs/common";
import { RestaurantCreated } from "@kade/proto/kade/catalog/v1/catalog_events";
import * as C from "@kade/proto/kade/catalog/v1/catalog_service";
import { OutletStatusChanged } from "@kade/proto/kade/merchant/v1/merchant_events";
import { OutletAdminStatus } from "@kade/proto/kade/merchant/v1/merchant_service";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../../src/app.js";
import { EVENT } from "../../src/catalog/events.js";
import { restaurantId } from "../../src/catalog/ids.js";
import { REFERENCE_LOCATION } from "../../src/catalog/seeder.js";
import { UPSTREAM } from "../../src/catalog/upstream-events.consumer.js";
import { loadConfig } from "../../src/platform/config.js";
import { decodeErrorInfo, STATUS_DETAILS_KEY } from "../../src/platform/grpc/error-details.js";
import { GrpcServer } from "../../src/platform/grpc/grpc-server.js";
import { createLogger } from "../../src/platform/logger.js";

const config = loadConfig({
  SERVICE_NAME: "catalog",
  DATABASE_URL: "postgres://catalog:catalog@localhost:15432/catalog",
  KAFKA_BROKERS: "localhost:19092",
  LOG_LEVEL: "warn",
  ...process.env,
  GRPC_PORT: "0",
  HTTP_PORT: "0",
  OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
  PRICING_GRPC: undefined,
  // Every seeded kitchen is open at 1 pm, so availability is deterministic.
  DEMO_TIME: "13:00",
});

let app: INestApplication;
let catalog: C.CatalogServiceClient;
let menus: C.MenuManagementServiceClient;
let restaurants: C.RestaurantManagementServiceClient;
let merch: C.MerchandisingServiceClient;
let pool: pg.Pool;
let kafka: KafkaJS.Kafka;
let producer: KafkaJS.Producer;
const created: string[] = [];

beforeAll(async () => {
  app = await startApp(config, createLogger(config));
  const address = `localhost:${app.get(GrpcServer).port}`;
  catalog = new C.CatalogServiceClient(address, credentials.createInsecure());
  menus = new C.MenuManagementServiceClient(address, credentials.createInsecure());
  restaurants = new C.RestaurantManagementServiceClient(address, credentials.createInsecure());
  merch = new C.MerchandisingServiceClient(address, credentials.createInsecure());
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  kafka = new KafkaJS.Kafka({ kafkaJS: { brokers: config.KAFKA_BROKERS, logLevel: KafkaJS.logLevel.ERROR } });
  producer = kafka.producer();
  await producer.connect();
});

afterAll(async () => {
  // Hide test restaurants everywhere: suspension flows catalog -> kade.restaurant.events -> search.
  for (const id of created)
    await outletStatus(id, { adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_SUSPENDED });
  if (created.length) {
    await eventually(async () => {
      const { rows } = await pool.query(
        "select count(*)::int n from restaurants where id = any($1) and admin_status = 'suspended'",
        [created],
      );
      return rows[0].n === created.length ? true : undefined;
    });
  }
  for (const c of [catalog, menus, restaurants, merch]) c?.close();
  await producer?.disconnect();
  await pool?.end();
  await app?.close();
});

// ---------- helpers ----------

type Codec<T> = { fromPartial(p: unknown): T };
function call<Req, Res>(
  client: Client,
  method: string,
  codec: Codec<Req>,
  req: unknown,
  md = new Metadata(),
): Promise<Res> {
  return new Promise((resolve, reject) =>
    (
      client as unknown as Record<
        string,
        (r: Req, m: Metadata, o: object, cb: (e: ServiceError | null, r: Res) => void) => void
      >
    )[method]!(codec.fromPartial(req), md, { deadline: Date.now() + 5_000 }, (err, res) =>
      err ? reject(err) : resolve(res),
    ),
  );
}

function who(roles: string, outletId?: string): Metadata {
  const md = new Metadata();
  md.set("x-user-id", "it-user");
  md.set("x-roles", roles);
  if (outletId) md.set("x-outlet-id", outletId);
  return md;
}

async function grpcError(promise: Promise<unknown>): Promise<{ code: status; reason: string | undefined }> {
  const err = (await promise.then(
    () => expect.unreachable("expected the call to fail"),
    (e: unknown) => e,
  )) as ServiceError;
  const details = err.metadata.get(STATUS_DETAILS_KEY)[0];
  return { code: err.code, reason: details ? decodeErrorInfo(details as Buffer)?.reason : undefined };
}

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 45_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function outletStatus(outletId: string, status: Partial<OutletStatusChanged["status"]>): Promise<void> {
  const value = OutletStatusChanged.encode(
    OutletStatusChanged.fromPartial({
      outletId,
      status: { adminStatus: OutletAdminStatus.OUTLET_ADMIN_STATUS_OPEN, ...status },
    }),
  ).finish();
  await producer.send({
    topic: "kade.merchant.events",
    messages: [
      {
        key: outletId,
        value: Buffer.from(value),
        headers: { id: uuidv7(), eventType: UPSTREAM.outletStatusChanged },
      },
    ],
  });
}

async function createTestRestaurant(): Promise<string> {
  const id = uuidv7();
  created.push(id);
  await call(restaurants, "createRestaurant", C.CreateRestaurantRequest, {
    restaurantId: id,
    details: {
      name: `IT Kitchen ${id.slice(-6)}`,
      categoryId: "kottu",
      cuisine: "Kottu",
      area: "Kollupitiya",
      location: { lat: 6.91, lng: 79.852 },
      prepMinMinutes: 10,
      prepMaxMinutes: 20,
    },
  });
  return id;
}

// ---------- customer reads over the seed ----------

describe("seeded catalogue", () => {
  it("lists the mock's restaurants with the mock's distances from Home", async () => {
    const res = await call<C.ListRestaurantsRequest, C.ListRestaurantsResponse>(
      catalog,
      "listRestaurants",
      C.ListRestaurantsRequest,
      {
        deliverTo: REFERENCE_LOCATION,
        ids: [...Array(16).keys()].map((i) => restaurantId(i + 1)),
      },
    );
    expect(res.restaurants).toHaveLength(16);
    const kottu = res.restaurants.find((r) => r.id === restaurantId(1))!;
    expect(kottu).toMatchObject({
      name: "Galle Road Kottu House",
      distanceKm: 1.2,
      deliveryFee: { amountMinor: 15_000 },
      offerLabel: "20% off kottu",
      discountPercent: 20,
      zoneId: "c03",
      imageId: "1589302168068-964664d93dc0",
    });
    // Ratings may since have been updated by review (kade.review.events).
    expect(kottu.ratingCount).toBeGreaterThan(0);
    expect(res.restaurants.find((r) => r.id === restaurantId(2))?.deliveryFee?.amountMinor).toBe(0);
  });

  it("filters by category and accepts the apps' numeric ids", async () => {
    const rice = await call<C.ListRestaurantsRequest, C.ListRestaurantsResponse>(
      catalog,
      "listRestaurants",
      C.ListRestaurantsRequest,
      {
        categoryId: "rice",
      },
    );
    expect(rice.restaurants.map((r) => r.name).sort()).toEqual(["Amma's Rice & Curry", "Jaffna Curry Pot"]);
    const one = await call<C.GetRestaurantRequest, C.GetRestaurantResponse>(
      catalog,
      "getRestaurant",
      C.GetRestaurantRequest,
      { id: "16" },
    );
    expect(one.restaurant?.name).toBe("Donut Republic");
    const cats = await call<C.ListCategoriesRequest, C.ListCategoriesResponse>(
      catalog,
      "listCategories",
      C.ListCategoriesRequest,
      {},
    );
    expect(cats.categories.slice(0, 3).map((c) => c.id)).toEqual(["all", "rice", "kottu"]);
  });

  it("serves the mock menu for a restaurant", async () => {
    const { menu } = await call<C.GetMenuRequest, C.GetMenuResponse>(catalog, "getMenu", C.GetMenuRequest, {
      restaurantId: "1",
    });
    expect(menu!.sections.map((s) => s.name)).toEqual([
      "Kottu",
      "Rice and noodles",
      "Devilled",
      "Short eats",
      "Drinks and dessert",
    ]);
    expect(menu!.popular.map((i) => i.name)).toEqual([
      "Chicken kottu",
      "Cheese kottu",
      "Devilled chicken",
      "Faluda",
    ]);
    expect(menu!.sections[0]!.items[0]).toMatchObject({
      id: "00000000-0000-7000-8010-000100000000",
      price: { amountMinor: 115_000 },
    });
    expect(menu!.optionGroups.map((g) => g.name)).toEqual(["Spice level", "Extras", "Portion", "Sweetness"]);
  });

  it("validates a cart and returns server prices", async () => {
    const res = await call<C.ValidateCartRequest, C.ValidateCartResponse>(
      catalog,
      "validateCart",
      C.ValidateCartRequest,
      {
        restaurantId: restaurantId(1),
        lines: [
          {
            lineKey: "a",
            itemId: "00000000-0000-7000-8010-000100000001",
            quantity: 1,
            options: [
              {
                optionGroupId: "00000000-0000-7000-8012-000001000001",
                choiceId: "00000000-0000-7000-8013-000100010003",
              },
              {
                optionGroupId: "00000000-0000-7000-8012-000001000002",
                choiceId: "00000000-0000-7000-8013-000100020002",
              },
            ],
          },
        ],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.lines[0]).toMatchObject({
      name: "Cheese kottu",
      unitPrice: { amountMinor: 170_000 },
      choiceNames: ["Sri Lankan hot", "Extra cheese"],
    });
    const bad = await call<C.ValidateCartRequest, C.ValidateCartResponse>(
      catalog,
      "validateCart",
      C.ValidateCartRequest,
      {
        restaurantId: restaurantId(1),
        lines: [{ lineKey: "b", itemId: "00000000-0000-7000-8010-000100000006", quantity: 1 }],
      },
    );
    expect(bad).toMatchObject({ ok: false, lines: [{ problem: C.LineProblem.LINE_PROBLEM_SOLD_OUT }] });
  });

  it("builds the home feed from the seeded collections", async () => {
    const feed = await call<C.GetHomeFeedRequest, C.GetHomeFeedResponse>(
      catalog,
      "getHomeFeed",
      C.GetHomeFeedRequest,
      {},
    );
    expect(feed.shelves.map((s) => s.collection?.title)).toContain("Offers near you");
    expect(feed.categories.length).toBeGreaterThanOrEqual(12);
  });

  it("maps errors to status codes with ErrorInfo reasons", async () => {
    expect(await grpcError(call(catalog, "getRestaurant", C.GetRestaurantRequest, { id: uuidv7() }))).toEqual(
      {
        code: status.NOT_FOUND,
        reason: "RESTAURANT_NOT_FOUND",
      },
    );
    expect(await grpcError(call(catalog, "getRestaurant", C.GetRestaurantRequest, { id: "kottu" }))).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "RESTAURANT_ID_INVALID",
    });
    expect(
      await grpcError(
        call(
          menus,
          "createMenuSection",
          C.CreateMenuSectionRequest,
          { restaurantId: restaurantId(1), name: "x" },
          who("merchant_staff", restaurantId(2)),
        ),
      ),
    ).toEqual({ code: status.PERMISSION_DENIED, reason: "OUTLET_MISMATCH" });
    expect(
      await grpcError(call(merch, "listCollections", C.ListCollectionsRequest, {}, who("customer"))),
    ).toEqual({
      code: status.PERMISSION_DENIED,
      reason: "PERMISSION_DENIED",
    });
  });
});

// ---------- writes, outbox and events ----------

describe("menu editing", () => {
  it("creates, edits, sells out and deletes dishes, publishing every change through the outbox", async () => {
    const rid = await createTestRestaurant();
    const staff = who("merchant_owner", rid);
    const { menu: withSection } = await call<C.CreateMenuSectionRequest, C.CreateMenuSectionResponse>(
      menus,
      "createMenuSection",
      C.CreateMenuSectionRequest,
      { restaurantId: rid, name: "Kottu" },
      staff,
    );
    const sectionId = withSection!.sections[0]!.id;
    expect(
      await grpcError(
        call(
          menus,
          "createMenuSection",
          C.CreateMenuSectionRequest,
          { restaurantId: rid, name: "kottu" },
          staff,
        ),
      ),
    ).toEqual({
      code: status.ALREADY_EXISTS,
      reason: "SECTION_NAME_TAKEN",
    });

    const { menu: withGroup } = await call<C.SaveOptionGroupRequest, C.SaveOptionGroupResponse>(
      menus,
      "saveOptionGroup",
      C.SaveOptionGroupRequest,
      {
        restaurantId: rid,
        optionGroup: {
          name: "Spice level",
          required: true,
          maxChoices: 1,
          choices: [{ name: "Mild" }, { name: "Hot" }],
        },
      },
      staff,
    );
    const groupId = withGroup!.optionGroups[0]!.id;

    const key = uuidv7();
    const save = {
      restaurantId: rid,
      idempotencyKey: key,
      item: {
        sectionId,
        name: "Chicken kottu",
        description: "With egg",
        price: { amountMinor: 115_000, currency: "LKR" },
        optionGroupIds: [groupId],
        tags: [C.DishTag.DISH_TAG_SPICY],
      },
    };
    const first = await call<C.SaveMenuItemRequest, C.SaveMenuItemResponse>(
      menus,
      "saveMenuItem",
      C.SaveMenuItemRequest,
      save,
      staff,
    );
    const again = await call<C.SaveMenuItemRequest, C.SaveMenuItemResponse>(
      menus,
      "saveMenuItem",
      C.SaveMenuItemRequest,
      save,
      staff,
    );
    expect(again.item?.id).toBe(first.item?.id);
    expect(first.menu!.sections[0]!.items).toHaveLength(1);
    const itemId = first.item!.id;

    const soldOut = await call<C.SetMenuItemSoldOutRequest, C.SetMenuItemSoldOutResponse>(
      menus,
      "setMenuItemSoldOut",
      C.SetMenuItemSoldOutRequest,
      { restaurantId: rid, itemId, soldOut: true },
      staff,
    );
    expect(soldOut.menu!.sections[0]!.items[0]).toMatchObject({ soldOut: true });
    expect(soldOut.menu!.sections[0]!.items[0]!.soldOutUntil).toBeInstanceOf(Date);

    expect(
      await grpcError(
        call(menus, "deleteMenuSection", C.DeleteMenuSectionRequest, { restaurantId: rid, sectionId }, staff),
      ),
    ).toEqual({
      code: status.FAILED_PRECONDITION,
      reason: "SECTION_NOT_EMPTY",
    });
    await call(
      menus,
      "deleteOptionGroup",
      C.DeleteOptionGroupRequest,
      { restaurantId: rid, optionGroupId: groupId },
      staff,
    );
    const afterDelete = await call<C.DeleteMenuItemRequest, C.DeleteMenuItemResponse>(
      menus,
      "deleteMenuItem",
      C.DeleteMenuItemRequest,
      { restaurantId: rid, itemId },
      staff,
    );
    expect(afterDelete.menu!.sections[0]!.items).toHaveLength(0);
    const final = await call<C.DeleteMenuSectionRequest, C.DeleteMenuSectionResponse>(
      menus,
      "deleteMenuSection",
      C.DeleteMenuSectionRequest,
      { restaurantId: rid, sectionId },
      staff,
    );
    expect(final.menu!.sections).toHaveLength(0);

    const { rows } = await pool.query(
      "select type from outbox where aggregateid = $1 order by created_at, id",
      [rid],
    );
    const types = rows.map((r: { type: string }) => r.type);
    expect(types.filter((t: string) => t === EVENT.menuUpdated).length).toBe(6); // section, group, item, group del, item del, section del
    expect(types).toContain(EVENT.itemAvailabilityChanged);
    expect(types.slice(0, 2)).toEqual([EVENT.restaurantCreated, EVENT.hoursChanged]);
  });
});

describe("hours and closures", () => {
  it("sets the week, adds and removes a closure", async () => {
    const rid = await createTestRestaurant();
    const ops = who("ops");
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      isOpen: day !== 1,
      ranges: day === 1 ? [] : [{ open: "11:00", close: "23:00" }],
    }));
    const set = await call<C.SetOpeningHoursRequest, C.SetOpeningHoursResponse>(
      restaurants,
      "setOpeningHours",
      C.SetOpeningHoursRequest,
      { restaurantId: rid, hours: week },
      ops,
    );
    expect(set.hours[0]).toMatchObject({ day: 1, isOpen: false });
    const added = await call<C.AddClosureRequest, C.AddClosureResponse>(
      restaurants,
      "addClosure",
      C.AddClosureRequest,
      { restaurantId: rid, date: "2026-10-26", reason: "Vap Poya" },
      ops,
    );
    expect(added.closures).toMatchObject([{ date: "2026-10-26", reason: "Vap Poya" }]);
    expect(
      await grpcError(
        call(restaurants, "addClosure", C.AddClosureRequest, { restaurantId: rid, date: "2026-10-26" }, ops),
      ),
    ).toEqual({
      code: status.ALREADY_EXISTS,
      reason: "CLOSURE_EXISTS",
    });
    const removed = await call<C.RemoveClosureRequest, C.RemoveClosureResponse>(
      restaurants,
      "removeClosure",
      C.RemoveClosureRequest,
      { restaurantId: rid, closureId: added.closures[0]!.id },
      ops,
    );
    expect(removed.closures).toEqual([]);
    expect(
      await grpcError(
        call(
          restaurants,
          "setOpeningHours",
          C.SetOpeningHoursRequest,
          { restaurantId: rid, hours: week.slice(0, 3) },
          ops,
        ),
      ),
    ).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "HOURS_INVALID",
    });
  });

  it("is idempotent on CreateRestaurant and updates details with changed_fields", async () => {
    const rid = await createTestRestaurant();
    const again = await call<C.CreateRestaurantRequest, C.CreateRestaurantResponse>(
      restaurants,
      "createRestaurant",
      C.CreateRestaurantRequest,
      {
        restaurantId: rid,
        details: { name: "Something else", categoryId: "kottu" },
      },
    );
    expect(again.restaurant?.name).toMatch(/^IT Kitchen/);
    const updated = await call<C.UpdateRestaurantDetailsRequest, C.UpdateRestaurantDetailsResponse>(
      restaurants,
      "updateRestaurantDetails",
      C.UpdateRestaurantDetailsRequest,
      {
        restaurantId: rid,
        details: { phone: "+94 11 000 0000", priceLevel: 2 },
      },
      who("merchant_owner", rid),
    );
    expect(updated.restaurant).toMatchObject({ phone: "+94 11 000 0000", priceLevel: 2 });
    const { rows } = await pool.query("select payload from outbox where aggregateid = $1 and type = $2", [
      rid,
      EVENT.restaurantUpdated,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("merchandising", () => {
  it("creates a hand-picked collection and toggles it", async () => {
    const ops = who("admin");
    const { collection } = await call<C.SaveCollectionRequest, C.SaveCollectionResponse>(
      merch,
      "saveCollection",
      C.SaveCollectionRequest,
      {
        collection: {
          title: "IT collection",
          placement: C.CollectionPlacement.COLLECTION_PLACEMENT_SHELF,
          source: C.CollectionSource.COLLECTION_SOURCE_HAND_PICKED,
          restaurantIds: ["1", restaurantId(2)],
          startsOn: "2026-10-01",
          visible: false,
        },
      },
      ops,
    );
    expect(collection?.restaurantIds).toEqual([restaurantId(1), restaurantId(2)]);
    const shown = await call<C.SetCollectionVisibleRequest, C.SetCollectionVisibleResponse>(
      merch,
      "setCollectionVisible",
      C.SetCollectionVisibleRequest,
      { id: collection!.id, visible: false },
      ops,
    );
    expect(shown.collection?.visible).toBe(false);
    await pool.query("delete from collections where id = $1", [collection!.id]);
    expect(
      await grpcError(
        call(
          merch,
          "saveCollection",
          C.SaveCollectionRequest,
          { collection: { title: "x", placement: 1, source: 2, restaurantIds: ["1"] } },
          ops,
        ),
      ),
    ).toEqual({
      code: status.INVALID_ARGUMENT,
      reason: "COLLECTION_TOO_FEW_RESTAURANTS",
    });
  });
});

describe("events", () => {
  it("publishes RestaurantCreated via outbox -> Debezium -> kade.restaurant.events", async () => {
    const rid = await createTestRestaurant();
    const consumer = kafka.consumer({ kafkaJS: { groupId: `catalog-it-${rid}`, fromBeginning: true } });
    await consumer.connect();
    await consumer.subscribe({ topics: ["kade.restaurant.events"] });
    const found = new Promise<RestaurantCreated>((resolve) => {
      void consumer.run({
        eachMessage: async ({ message }) => {
          if (
            message.key?.toString() === rid &&
            message.headers?.eventType?.toString() === EVENT.restaurantCreated
          ) {
            resolve(RestaurantCreated.decode(message.value!));
          }
        },
      });
    });
    try {
      const event = await Promise.race([
        found,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("no RestaurantCreated on the topic")), 45_000),
        ),
      ]);
      expect(event.restaurant).toMatchObject({ id: rid, categoryId: "kottu", etaMinMinutes: 20 });
    } finally {
      await consumer.disconnect();
    }
  });

  it("folds merchant pause events into availability and re-publishes them", async () => {
    const rid = await createTestRestaurant();
    // Far enough ahead to beat DEMO_TIME's pinned clock.
    const until = new Date(Date.now() + 48 * 60 * 60_000);
    await outletStatus(rid, { pausedUntil: until, busyExtraMinutes: 10 });
    const restaurant = await eventually(async () => {
      const r = await call<C.GetRestaurantRequest, C.GetRestaurantResponse>(
        catalog,
        "getRestaurant",
        C.GetRestaurantRequest,
        { id: rid },
      );
      return r.restaurant?.availability?.state === C.AvailabilityState.AVAILABILITY_STATE_PAUSED
        ? r.restaurant
        : undefined;
    });
    expect(restaurant.etaMinMinutes).toBe(30);
    const { rows } = await pool.query("select type from outbox where aggregateid = $1 and type = $2", [
      rid,
      EVENT.availabilityChanged,
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
