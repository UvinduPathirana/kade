import { credentials, Metadata } from "@grpc/grpc-js";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import {
  RestaurantManagementServiceClient,
  type CreateRestaurantRequest,
  type CreateRestaurantResponse,
} from "@kade/proto/kade/catalog/v1/catalog_service";
import { CONFIG, type Config } from "../platform/config.js";
import type { RequestContext } from "../platform/grpc/context.js";

const DEADLINE_MS = 2_000;

/** catalog.RestaurantManagementService, for creating the restaurant when an application is approved. */
@Injectable()
export class CatalogClient implements OnApplicationShutdown {
  private readonly client: RestaurantManagementServiceClient | undefined;

  constructor(@Inject(CONFIG) config: Config) {
    this.client = config.CATALOG_GRPC
      ? new RestaurantManagementServiceClient(config.CATALOG_GRPC, credentials.createInsecure())
      : undefined;
  }

  get configured(): boolean {
    return !!this.client;
  }

  /** Idempotent on restaurant_id (catalog contract); safe to retry. */
  createRestaurant(request: CreateRestaurantRequest, ctx: RequestContext): Promise<CreateRestaurantResponse> {
    const client = this.client;
    if (!client) return Promise.reject(new Error("CATALOG_GRPC is not configured"));
    const md = new Metadata();
    if (ctx.userId) md.set("x-user-id", ctx.userId);
    if (ctx.roles.length) md.set("x-roles", ctx.roles.join(","));
    return new Promise((resolve, reject) =>
      client.createRestaurant(request, md, { deadline: Date.now() + DEADLINE_MS }, (err, res) =>
        err ? reject(err) : resolve(res),
      ),
    );
  }

  onApplicationShutdown(): void {
    this.client?.close();
  }
}
