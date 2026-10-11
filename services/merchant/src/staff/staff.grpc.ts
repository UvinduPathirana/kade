import { Inject, Injectable } from "@nestjs/common";
import {
  OutletStaffServiceService,
  type ChangeOutletStaffRoleRequest,
  type ChangeOutletStaffRoleResponse,
  type GetMyOutletsRequest,
  type GetMyOutletsResponse,
  type InviteOutletStaffRequest,
  type InviteOutletStaffResponse,
  type ListOutletStaffRequest,
  type ListOutletStaffResponse,
  type OutletStaffMember,
  type RemoveOutletStaffRequest,
  type RemoveOutletStaffResponse,
} from "@kade/proto/kade/merchant/v1/merchant_service";
import { v7 as uuidv7 } from "uuid";
import { staffRole } from "../domain/enums.js";
import { MerchantEvents } from "../domain/merchant-events.js";
import { normalisePhone } from "../domain/values.js";
import { OutletAccess } from "../outlets/outlet-access.js";
import { Database, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { alreadyExists, failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { StaffRepository, type StaffRow } from "./staff.repository.js";

/** kade.merchant.v1.OutletStaffService: the outlet's team, and which outlets a signed-in user works at. */
@GrpcService(OutletStaffServiceService)
@Injectable()
export class StaffGrpcService implements GrpcHandlers<OutletStaffServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutletAccess) private readonly access: OutletAccess,
    @Inject(StaffRepository) private readonly staff: StaffRepository,
    @Inject(MerchantEvents) private readonly events: MerchantEvents,
  ) {}

  async listOutletStaff(
    request: ListOutletStaffRequest,
    ctx: RequestContext,
  ): Promise<ListOutletStaffResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId);
    return { staff: (await this.staff.listByOutlet(this.database.db, outlet.id)).map(toMember) };
  }

  async inviteOutletStaff(
    request: InviteOutletStaffRequest,
    ctx: RequestContext,
  ): Promise<InviteOutletStaffResponse> {
    const name = request.name.trim().replace(/\s+/g, " ");
    if (!name) throw invalidArgument("NAME_REQUIRED", "Enter their name.", { field: "name" });
    if (name.length > 80)
      throw invalidArgument("NAME_TOO_LONG", "Keep the name under 80 characters.", { field: "name" });
    const phone = normalisePhone(request.phone);
    const role = staffRole.toDb(request.role);
    if (!role) throw invalidArgument("ROLE_INVALID", "Choose owner, manager or kitchen.", { field: "role" });

    const { outlet } = await this.access.authorise(ctx, request.outletId, "owner");
    const member = await this.database.transaction(ctx, async (tx) => {
      await this.staff.lockTeam(tx, outlet.id);
      const row = await this.staff.insert(tx, {
        id: uuidv7(),
        outletId: outlet.id,
        userId: null,
        name,
        phone,
        role,
        pending: true,
      });
      if (!row) {
        throw alreadyExists("STAFF_PHONE_EXISTS", "Someone with this number is already on your team.", {
          field: "phone",
        });
      }
      const m = toMember(row);
      await this.events.staffInvited(tx, {
        outletId: outlet.id,
        member: m,
        outletName: outlet.name,
        occurredAt: new Date(),
      });
      return m;
    });
    return { member };
  }

  async changeOutletStaffRole(
    request: ChangeOutletStaffRoleRequest,
    ctx: RequestContext,
  ): Promise<ChangeOutletStaffRoleResponse> {
    const role = staffRole.toDb(request.role);
    if (!role) throw invalidArgument("ROLE_INVALID", "Choose owner, manager or kitchen.", { field: "role" });
    const { outlet } = await this.access.authorise(ctx, request.outletId, "owner");
    const staff = await this.database.transaction(ctx, async (tx) => {
      const team = await this.lockedTeam(tx, outlet.id);
      const target = team.find((s) => s.id === request.staffId);
      if (!target) throw staffNotFound(request.staffId);
      if (target.role === "owner" && role !== "owner") assertAnotherOwner(team, target.id);
      await this.staff.setRole(tx, target.id, role);
      return this.staff.listByOutlet(tx, outlet.id);
    });
    return { staff: staff.map(toMember) };
  }

  async removeOutletStaff(
    request: RemoveOutletStaffRequest,
    ctx: RequestContext,
  ): Promise<RemoveOutletStaffResponse> {
    const { outlet } = await this.access.authorise(ctx, request.outletId, "owner");
    const staff = await this.database.transaction(ctx, async (tx) => {
      const team = await this.lockedTeam(tx, outlet.id);
      const target = team.find((s) => s.id === request.staffId);
      if (!target) throw staffNotFound(request.staffId);
      if (target.role === "owner") assertAnotherOwner(team, target.id);
      await this.staff.remove(tx, target.id);
      return this.staff.listByOutlet(tx, outlet.id);
    });
    return { staff: staff.map(toMember) };
  }

  async getMyOutlets(_request: GetMyOutletsRequest, ctx: RequestContext): Promise<GetMyOutletsResponse> {
    const userId = ctx.requireUser();
    const outlets = await this.staff.outletsOfUser(this.database.db, userId);
    return {
      outlets: outlets.map((o) => ({
        outletId: o.outletId,
        outletName: o.outletName,
        role: staffRole.toProto(o.role),
      })),
    };
  }

  private async lockedTeam(tx: Tx, outletId: string): Promise<StaffRow[]> {
    await this.staff.lockTeam(tx, outletId);
    return this.staff.listByOutlet(tx, outletId);
  }
}

function assertAnotherOwner(team: StaffRow[], exceptId: string): void {
  if (!team.some((s) => s.role === "owner" && s.id !== exceptId)) {
    throw failedPrecondition("LAST_OWNER", "Your team needs at least one owner.");
  }
}

function staffNotFound(id: string) {
  return notFound("STAFF_NOT_FOUND", "That person isn't on your team any more.", { staff_id: id });
}

export function toMember(row: StaffRow): OutletStaffMember {
  return {
    id: row.id,
    outletId: row.outletId,
    name: row.name,
    phone: row.phone,
    role: staffRole.toProto(row.role),
    lastActiveAt: row.lastActiveAt ?? undefined,
    pending: row.pending,
  };
}
