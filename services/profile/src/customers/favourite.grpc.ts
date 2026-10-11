import { Inject, Injectable } from "@nestjs/common";
import {
  FavouriteServiceService,
  type AddFavouriteRequest,
  type AddFavouriteResponse,
  type ListFavouritesRequest,
  type ListFavouritesResponse,
  type RemoveFavouriteRequest,
  type RemoveFavouriteResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { assertCustomerAccess, requireCustomerId, requireId } from "../shared/access.js";
import { ProfileStore } from "./profile-store.js";

/** kade.profile.v1.FavouriteService. Add and remove are idempotent. */
@GrpcService(FavouriteServiceService)
@Injectable()
export class FavouriteGrpcService implements GrpcHandlers<FavouriteServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
  ) {}

  async listFavourites(request: ListFavouritesRequest, ctx: RequestContext): Promise<ListFavouritesResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const rows = await this.store.listFavourites(this.database.db, id);
    return { favourites: rows.map((r) => ({ restaurantId: r.restaurantId, addedAt: r.addedAt })) };
  }

  async addFavourite(request: AddFavouriteRequest, ctx: RequestContext): Promise<AddFavouriteResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const restaurantId = requireId(request.restaurantId, "restaurant_id", "RESTAURANT_ID_REQUIRED");
    return this.database.transaction(ctx, async (tx) => {
      await this.store.ensure(tx, { id });
      const row = await this.store.addFavourite(tx, id, restaurantId);
      return { favourite: { restaurantId: row.restaurantId, addedAt: row.addedAt } };
    });
  }

  async removeFavourite(
    request: RemoveFavouriteRequest,
    ctx: RequestContext,
  ): Promise<RemoveFavouriteResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const restaurantId = requireId(request.restaurantId, "restaurant_id", "RESTAURANT_ID_REQUIRED");
    await this.database.transaction(ctx, (tx) => this.store.removeFavourite(tx, id, restaurantId));
    return {};
  }
}
