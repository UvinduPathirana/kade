import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { places, popularSearches } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import { seedPlaces, seedPopularSearches } from "./places-data.js";

/** Reference data search owns: the address-picker places and the suggested searches. Idempotent. */
@Injectable()
export class SearchSeeder implements OnApplicationBootstrap {
  constructor(@Inject(Database) private readonly database: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.database.transaction(undefined, async (tx) => {
      await tx
        .insert(places)
        .values(seedPlaces.map((p, position) => ({ ...p, position })))
        .onConflictDoUpdate({
          target: places.id,
          set: {
            name: sql`excluded.name`,
            detail: sql`excluded.detail`,
            area: sql`excluded.area`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            inZone: sql`excluded.in_zone`,
            zoneId: sql`excluded.zone_id`,
            position: sql`excluded.position`,
          },
        });
      await tx
        .insert(popularSearches)
        .values(seedPopularSearches.map((query, position) => ({ query, position })))
        .onConflictDoNothing();
    });
  }
}
