import { Inject, Injectable } from "@nestjs/common";
import {
  OutletAdminServiceService,
  OutletAdminStatus,
  type GetOutletAdminRequest,
  type GetOutletAdminResponse,
  type ListOutletsRequest,
  type ListOutletsResponse,
  type SetOutletStatusRequest,
  type SetOutletStatusResponse,
  type UpdateCommissionRequest,
  type UpdateCommissionResponse,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { adminStatus } from "../domain/enums.js";
import { actorOf, MerchantEvents } from "../domain/merchant-events.js";
import { Database, type Queryable } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { decodePage, encodePage } from "../domain/paging.js";
import { OutletAccess } from "./outlet-access.js";
import { toAdminView } from "./outlet-mapper.js";
import { OutletStatusUpdater } from "./outlet-status.js";
import { OutletsRepository, type OutletRow } from "./outlets.repository.js";

export const MAX_COMMISSION_BPS = 3500;

/** kade.merchant.v1.OutletAdminService: the admin console's restaurants page. */
@GrpcService(OutletAdminServiceService)
@Injectable()
export class OutletAdminGrpcService implements GrpcHandlers<OutletAdminServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutletAccess) private readonly access: OutletAccess,
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(OutletStatusUpdater) private readonly status: OutletStatusUpdater,
    @Inject(MerchantEvents) private readonly events: MerchantEvents,
  ) {}

  async listOutlets(request: ListOutletsRequest, ctx: RequestContext): Promise<ListOutletsResponse> {
    this.access.requireOps(ctx, ["finance"]);
    const { offset, size } = decodePage(request.page, 50, 200);
    const status =
      request.status === OutletAdminStatus.OUTLET_ADMIN_STATUS_UNSPECIFIED
        ? undefined
        : adminStatus.toDb(request.status);
    const { rows, total } = await this.outlets.list(
      this.database.db,
      { adminStatus: status, zoneId: request.zoneId.trim(), query: request.query.trim() },
      offset,
      size,
    );
    return {
      outlets: await this.views(this.database.db, rows),
      page: encodePage(offset, rows.length, total),
    };
  }

  async getOutletAdmin(request: GetOutletAdminRequest, ctx: RequestContext): Promise<GetOutletAdminResponse> {
    this.access.requireOps(ctx, ["finance"]);
    const row = await this.mustFind(this.database.db, request.outletId);
    return { outlet: (await this.views(this.database.db, [row]))[0] };
  }

  async updateCommission(
    request: UpdateCommissionRequest,
    ctx: RequestContext,
  ): Promise<UpdateCommissionResponse> {
    this.access.requireOps(ctx, ["finance"]);
    const bps = request.commissionBps;
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) {
      throw invalidArgument("COMMISSION_OUT_OF_RANGE", "Commission must be between 0% and 35%.", {
        field: "commission_bps",
      });
    }
    const row = await this.database.transaction(ctx, async (tx) => {
      const before = await this.outlets.lock(tx, request.outletId);
      if (!before) throw outletNotFound(request.outletId);
      if (before.commissionBps === bps) return before;
      const after = await this.outlets.update(tx, before.id, { commissionBps: bps });
      await this.events.outletCommissionChanged(tx, {
        outletId: before.id,
        commissionBps: bps,
        previousBps: before.commissionBps,
        actor: actorOf(ctx),
        occurredAt: new Date(),
      });
      return after;
    });
    return { outlet: (await this.views(this.database.db, [row]))[0] };
  }

  async setOutletStatus(
    request: SetOutletStatusRequest,
    ctx: RequestContext,
  ): Promise<SetOutletStatusResponse> {
    this.access.requireOps(ctx);
    const status = adminStatus.toDb(request.status);
    if (!status) {
      throw invalidArgument("OUTLET_STATUS_INVALID", "Choose open, paused, suspended or closed.", {
        field: "status",
      });
    }
    const reason = request.reason.trim();
    if (status !== "open" && !reason) {
      throw invalidArgument("REASON_REQUIRED", "Give a reason the restaurant can see.", { field: "reason" });
    }
    const row = await this.database.transaction(ctx, async (tx) => {
      await this.mustFind(tx, request.outletId);
      return this.status.change(tx, request.outletId, actorOf(ctx), () => ({
        adminStatus: status,
        adminStatusReason: status === "open" ? "" : reason,
      }));
    });
    return { outlet: (await this.views(this.database.db, [row]))[0] };
  }

  private async mustFind(db: Queryable, id: string): Promise<OutletRow> {
    const row = await this.outlets.find(db, id);
    if (!row) throw outletNotFound(id);
    return row;
  }

  private async views(db: Queryable, rows: OutletRow[]) {
    const now = new Date();
    const stats = await this.outlets.stats(
      db,
      rows.map((r) => r.id),
      now,
    );
    return rows.map((r) => toAdminView(r, stats.get(r.id), now));
  }
}

function outletNotFound(id: string) {
  return notFound("OUTLET_NOT_FOUND", "We couldn't find that restaurant.", { outlet_id: id });
}
