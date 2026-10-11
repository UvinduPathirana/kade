import { Inject, Injectable } from "@nestjs/common";
import {
  JoinPlusRequest,
  JoinPlusResponse,
  PlusPlan,
  PlusServiceService,
  PlusStatus,
  type CancelPlusRequest,
  type CancelPlusResponse,
  type GetPlusMembershipRequest,
  type GetPlusMembershipResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { failedPrecondition, invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { assertCustomerAccess, requireCustomerId } from "../shared/access.js";
import {
  cardLabel,
  plusActive,
  plusRenewsAt,
  plusToProto,
  PLUS_PRICE_MINOR,
  TRIAL_MS,
  type PlusRow,
} from "./plus.js";
import { ProfileStore } from "./profile-store.js";

/** kade.profile.v1.PlusService. Charging at the end of the free month is payment's job (purpose PLUS). */
@GrpcService(PlusServiceService)
@Injectable()
export class PlusGrpcService implements GrpcHandlers<PlusServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
  ) {}

  async getPlusMembership(
    request: GetPlusMembershipRequest,
    ctx: RequestContext,
  ): Promise<GetPlusMembershipResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    return { membership: plusToProto(await this.store.plusRow(this.database.db, id), Date.now()) };
  }

  async joinPlus(request: JoinPlusRequest, ctx: RequestContext): Promise<JoinPlusResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    if (request.plan !== PlusPlan.PLUS_PLAN_MONTHLY && request.plan !== PlusPlan.PLUS_PLAN_YEARLY) {
      throw invalidArgument("PLUS_PLAN_REQUIRED", "Choose monthly or yearly.", { field: "plan" });
    }
    const cardId = request.cardId.trim();
    if (!cardId) {
      throw invalidArgument("PLUS_CARD_REQUIRED", "Choose a card for when the free month ends.", {
        field: "card_id",
      });
    }
    const plan = request.plan;
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `JoinPlus:${id}`,
          key: request.idempotencyKey.trim(),
          request: JoinPlusRequest.encode(request).finish(),
          codec: JoinPlusResponse,
        },
        async () => {
          await this.store.ensure(tx, { id });
          await this.store.lock(tx, id);
          const now = Date.now();
          const current = await this.store.plusRow(tx, id);
          if (current?.status === PlusStatus.PLUS_STATUS_MEMBER) {
            throw failedPrecondition("PLUS_ALREADY_MEMBER", "You're already a Kadé Plus member.");
          }
          const next: PlusRow = {
            customerId: id,
            status: PlusStatus.PLUS_STATUS_MEMBER,
            plan,
            cardId,
            cardLabel: cardLabel(cardId),
            priceMinor: PLUS_PRICE_MINOR[plan],
            endsAt: null,
            updatedAt: new Date(now),
            ...(current && plusActive(current, now)
              ? // Rejoining inside the paid period: same schedule, no second free month.
                { joinedAt: current.joinedAt, trialEndsAt: current.trialEndsAt }
              : current
                ? // Came back after it lapsed: no free month again; charged from today.
                  { joinedAt: new Date(now), trialEndsAt: new Date(now) }
                : { joinedAt: new Date(now), trialEndsAt: new Date(now + TRIAL_MS) }),
          };
          const saved = await this.store.savePlus(tx, next);
          return { membership: plusToProto(saved, now) };
        },
      ),
    );
  }

  async cancelPlus(request: CancelPlusRequest, ctx: RequestContext): Promise<CancelPlusResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    return this.database.transaction(ctx, async (tx) => {
      const current = await this.store.plusRow(tx, id);
      if (current?.status !== PlusStatus.PLUS_STATUS_MEMBER) {
        throw failedPrecondition("PLUS_NOT_MEMBER", "You're not a Kadé Plus member.");
      }
      await this.store.lock(tx, id);
      const now = Date.now();
      const saved = await this.store.savePlus(tx, {
        ...current,
        status: PlusStatus.PLUS_STATUS_CANCELLED,
        endsAt: plusRenewsAt(current, now),
        updatedAt: new Date(now),
      });
      return { membership: plusToProto(saved, now) };
    });
  }
}
