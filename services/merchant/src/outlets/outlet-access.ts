import { Inject, Injectable } from "@nestjs/common";
import { staffRank, type StaffRoleDb } from "../domain/enums.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument, notFound, permissionDenied, unauthenticated } from "../platform/grpc/errors.js";
import { StaffRepository, type StaffRow } from "../staff/staff.repository.js";
import { OutletsRepository, type OutletRow } from "./outlets.repository.js";

/** Kadé staff roles that may act on any outlet (admin console, support). */
export const OPS_ROLES = ["ops", "admin", "support"] as const;
const MERCHANT_ROLES = ["merchant_staff", "merchant_owner"];

export interface OutletCaller {
  outlet: OutletRow;
  /** The caller's team row, when they are on the team (not for ops). */
  staff: StaffRow | undefined;
  /** Effective outlet role; "owner" for ops. */
  role: StaffRoleDb;
  isOps: boolean;
}

/**
 * Outlet-scoped authorisation. The gateway sets x-user-id (Keycloak sub), x-roles and x-outlet-id;
 * merchant decides:
 *  - ops/admin/support may act on any outlet;
 *  - otherwise the caller must be on the outlet's team (outlet_staff.user_id = x-user-id) with at
 *    least `minRole`; or, if not on the team, carry x-outlet-id = this outlet and a merchant role
 *    (the gateway resolved the outlet itself), with merchant_owner → owner, merchant_staff → kitchen.
 *  - x-outlet-id, when present, must match the outlet in the request.
 * An empty outlet_id in the request falls back to x-outlet-id, then to the caller's only outlet.
 */
@Injectable()
export class OutletAccess {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(StaffRepository) private readonly staff: StaffRepository,
  ) {}

  async authorise(
    ctx: RequestContext,
    requestOutletId: string,
    minRole: StaffRoleDb = "kitchen",
    opts: { allowOps?: boolean } = {},
  ): Promise<OutletCaller> {
    const allowOps = opts.allowOps ?? true;
    const userId = ctx.userId;
    if (!userId) throw unauthenticated("UNAUTHENTICATED", "Sign in to continue.");
    let outletId = requestOutletId || ctx.outletId;
    if (!outletId) {
      // No outlet named: fine when the caller works at exactly one.
      const mine = await this.staff.outletsOfUser(this.database.db, userId);
      if (mine.length !== 1) {
        throw invalidArgument("OUTLET_ID_REQUIRED", "Choose an outlet.", { field: "outlet_id" });
      }
      outletId = mine[0]!.outletId;
    }

    const isOps = OPS_ROLES.some((r) => ctx.hasRole(r));
    if (!isOps && ctx.outletId && ctx.outletId !== outletId) throw forbidden();

    const outlet = await this.outlets.find(this.database.db, outletId);
    if (!outlet) {
      throw notFound("OUTLET_NOT_FOUND", "We couldn't find that outlet.", { outlet_id: outletId });
    }
    if (isOps && allowOps) return { outlet, staff: undefined, role: "owner", isOps: true };

    const member = await this.staff.findMember(this.database.db, outletId, userId);
    let role: StaffRoleDb | undefined = member?.role as StaffRoleDb | undefined;
    if (!member) {
      if (ctx.outletId === outletId && MERCHANT_ROLES.some((r) => ctx.hasRole(r))) {
        role = ctx.hasRole("merchant_owner") ? "owner" : "kitchen";
      }
    }
    if (!role) throw forbidden();
    if (staffRank(role) < staffRank(minRole)) {
      throw permissionDenied("OUTLET_ROLE_REQUIRED", `Only an outlet ${minRole} can do this.`, {
        required: minRole,
      });
    }
    if (member) await this.staff.touch(this.database.db, member.id, new Date());
    return { outlet, staff: member, role, isOps: false };
  }

  /** Admin console calls: ops roles only (finance too where money is involved). */
  requireOps(ctx: RequestContext, extra: string[] = []): void {
    ctx.requireUser();
    ctx.requireRole(...OPS_ROLES, ...extra);
  }
}

function forbidden() {
  return permissionDenied("OUTLET_FORBIDDEN", "You don't have access to this outlet.");
}
