import { credentials, Metadata, type ServiceError } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import {
  CatalogServiceClient,
  GetMenuRequest,
  GetOpeningHoursRequest,
  ListRestaurantsRequest,
  RestaurantManagementServiceClient,
  type GetMenuResponse,
  type GetOpeningHoursResponse,
  type ListRestaurantsResponse,
  type Restaurant,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { setTimeout as sleep } from "node:timers/promises";
import { CONFIG, type Config } from "../platform/config.js";
import { Database } from "../platform/db/database.js";
import { LOGGER, type Logger } from "../platform/logger.js";
import { Projection } from "./projection.js";

const DEADLINE_MS = 5_000;
const ATTEMPTS = 12;
const RETRY_MS = 5_000;

/**
 * The projection's rebuild path. The live path is the Kafka consumer (a new consumer group replays
 * kade.restaurant.events / kade.menu.events from the earliest offset), but topics keep only 7 days,
 * so a rebuild also pulls every restaurant's current snapshot, hours and menu from catalog.
 * Writes use the same guarded upserts as the consumer, so racing the live stream is harmless.
 */
@Injectable()
export class Backfill implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly catalog: CatalogServiceClient | undefined;
  private readonly management: RestaurantManagementServiceClient | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Projection) private readonly projection: Projection,
    @Inject(CONFIG) config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    if (config.CATALOG_GRPC) {
      this.catalog = new CatalogServiceClient(config.CATALOG_GRPC, credentials.createInsecure());
      this.management = new RestaurantManagementServiceClient(
        config.CATALOG_GRPC,
        credentials.createInsecure(),
      );
    }
  }

  /** An empty index (first start, or a wiped database) fills itself from catalog in the background. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.catalog) return;
    if ((await this.projection.restaurantCount(this.database.db)) > 0) return;
    this.start("empty index on startup");
  }

  /** Drops the projection and rebuilds it. Returns when the rebuild started. */
  async rebuild(): Promise<Date> {
    const startedAt = new Date();
    await this.running?.catch(() => undefined);
    await this.database.transaction(undefined, (tx) => this.projection.truncate(tx));
    this.logger.info("search index dropped for rebuild");
    this.start("RebuildIndex");
    return startedAt;
  }

  /** Visible for tests: resolves when the current backfill (if any) has finished. */
  async idle(): Promise<void> {
    await this.running?.catch(() => undefined);
  }

  private start(reason: string): void {
    if (!this.catalog) {
      this.logger.warn({ reason }, "CATALOG_GRPC unset: the index rebuilds from the Kafka topics only");
      return;
    }
    this.running = this.withRetries(reason).finally(() => (this.running = undefined));
  }

  private async withRetries(reason: string): Promise<void> {
    for (let attempt = 1; attempt <= ATTEMPTS && !this.stopped; attempt++) {
      try {
        const count = await this.backfillOnce();
        this.logger.info({ reason, restaurants: count }, "search index backfilled from catalog");
        return;
      } catch (err) {
        this.logger.warn(
          { err: (err as Error).message, attempt, reason },
          "search backfill failed; retrying",
        );
        await sleep(RETRY_MS);
      }
    }
  }

  async backfillOnce(): Promise<number> {
    const at = new Date();
    const restaurants: Restaurant[] = [];
    let pageToken = "";
    do {
      const res = await this.call<ListRestaurantsResponse>((md, deadline, cb) =>
        this.catalog!.listRestaurants(
          ListRestaurantsRequest.fromPartial({ page: { pageSize: 100, pageToken } }),
          md,
          { deadline },
          cb,
        ),
      );
      restaurants.push(...res.restaurants);
      pageToken = res.page?.nextPageToken ?? "";
    } while (pageToken);

    for (const restaurant of restaurants) {
      const hours = await this.call<GetOpeningHoursResponse>((md, deadline, cb) =>
        this.management!.getOpeningHours(
          GetOpeningHoursRequest.fromPartial({ restaurantId: restaurant.id }),
          md,
          { deadline },
          cb,
        ),
      );
      const { menu } = await this.call<GetMenuResponse>((md, deadline, cb) =>
        this.catalog!.getMenu(
          GetMenuRequest.fromPartial({ restaurantId: restaurant.id }),
          md,
          { deadline },
          cb,
        ),
      );
      await this.database.transaction(undefined, async (tx) => {
        await this.projection.upsertRestaurant(
          tx,
          { ...restaurant, deliveryFee: undefined, distanceKm: 0 },
          at,
        );
        await this.projection.setHours(
          tx,
          restaurant.id,
          hours.hours,
          hours.closures.map((c) => c.date),
          at,
        );
        if (menu) await this.projection.replaceMenu(tx, menu);
      });
    }
    return restaurants.length;
  }

  private call<T>(
    invoke: (md: Metadata, deadline: Date, cb: (err: ServiceError | null, res: T) => void) => void,
  ): Promise<T> {
    return new Promise((resolve, reject) =>
      invoke(new Metadata(), new Date(Date.now() + DEADLINE_MS), (err, res) =>
        err ? reject(err) : resolve(res),
      ),
    );
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    this.catalog?.close();
    this.management?.close();
  }
}
