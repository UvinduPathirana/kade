import { Inject, Injectable } from "@nestjs/common";
import {
  StaffRole,
  StaffServiceService,
  StaffStatus,
  type ChangeStaffRoleRequest,
  type ChangeStaffRoleResponse,
  type GetPermissionMatrixResponse,
  type InviteStaffRequest,
  type InviteStaffResponse,
  type ListStaffResponse,
  type RemoveStaffRequest,
  type RemoveStaffResponse,
  type RolePermissions,
  type SavePermissionMatrixRequest,
  type SavePermissionMatrixResponse,
  type Staff,
} from "@kade/proto/kade/identity/v1/identity_service";
import { asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { rolePermissions, staff } from "../db/schema.js";
import { Database, type Queryable, type Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { alreadyExists, failedPrecondition, invalidArgument, notFound } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { requireStaff } from "../shared/access.js";
import { PERMISSIONS } from "../seed/demo-data.js";

export type StaffRow = typeof staff.$inferSelect;

const ROLES = [
  StaffRole.STAFF_ROLE_ADMIN,
  StaffRole.STAFF_ROLE_OPS,
  StaffRole.STAFF_ROLE_FINANCE,
  StaffRole.STAFF_ROLE_SUPPORT,
];
const ROLE_TITLES: Record<number, string> = {
  [StaffRole.STAFF_ROLE_ADMIN]: "Admin",
  [StaffRole.STAFF_ROLE_OPS]: "Ops",
  [StaffRole.STAFF_ROLE_FINANCE]: "Finance",
  [StaffRole.STAFF_ROLE_SUPPORT]: "Support",
};
const KADE_EMAIL = /^[^@\s]+@kade\.lk$/;
const PERMISSION_IDS = new Set(PERMISSIONS.map((p) => p.id));

/**
 * kade.identity.v1.StaffService: the admin console's team page. The staff table is the source of
 * truth for the team list, titles and the permission matrix; Keycloak holds logins and roles. Demo
 * Keycloak staff users (admin, ops, finance, support) are rows keyed by their Keycloak sub.
 * Invites are recorded here as INVITED (no Keycloak account or email is created in dev).
 */
@GrpcService(StaffServiceService)
@Injectable()
export class StaffGrpcService implements GrpcHandlers<StaffServiceService> {
  constructor(@Inject(Database) private readonly database: Database) {}

  async listStaff(_request: unknown, ctx: RequestContext): Promise<ListStaffResponse> {
    requireStaff(ctx);
    const rows = await this.database.db.select().from(staff).orderBy(asc(staff.createdAt), asc(staff.name));
    return { staff: rows.map(staffToProto) };
  }

  async inviteStaff(request: InviteStaffRequest, ctx: RequestContext): Promise<InviteStaffResponse> {
    requireStaff(ctx, "admin");
    const name = request.name.trim();
    const email = request.email.trim().toLowerCase();
    if (!name) throw invalidArgument("STAFF_NAME_REQUIRED", "Enter their full name.", { field: "name" });
    if (!KADE_EMAIL.test(email)) {
      throw invalidArgument("STAFF_EMAIL_INVALID", "Use their @kade.lk work email.", { field: "email" });
    }
    const role = requireRole(request.role);
    return this.database.transaction(ctx, async (tx) => {
      const [row] = await tx
        .insert(staff)
        .values({
          id: uuidv7(),
          name,
          email,
          role,
          title: request.title.trim() || ROLE_TITLES[role]!,
          status: StaffStatus.STAFF_STATUS_INVITED,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw alreadyExists("STAFF_EXISTS", `${email} is already on the team.`, { email });
      return { staff: staffToProto(row) };
    });
  }

  async changeStaffRole(
    request: ChangeStaffRoleRequest,
    ctx: RequestContext,
  ): Promise<ChangeStaffRoleResponse> {
    requireStaff(ctx, "admin");
    const role = requireRole(request.role);
    return this.database.transaction(ctx, async (tx) => {
      const current = await lockStaff(tx, request.staffId);
      if (current.role === StaffRole.STAFF_ROLE_ADMIN && role !== StaffRole.STAFF_ROLE_ADMIN) {
        await assertAnotherAdmin(tx, current.id);
      }
      const [row] = await tx.update(staff).set({ role }).where(eq(staff.id, current.id)).returning();
      return { staff: staffToProto(row!) };
    });
  }

  async removeStaff(request: RemoveStaffRequest, ctx: RequestContext): Promise<RemoveStaffResponse> {
    requireStaff(ctx, "admin");
    await this.database.transaction(ctx, async (tx) => {
      const current = await lockStaff(tx, request.staffId);
      if (current.role === StaffRole.STAFF_ROLE_ADMIN) await assertAnotherAdmin(tx, current.id);
      await tx.delete(staff).where(eq(staff.id, current.id));
    });
    return {};
  }

  async getPermissionMatrix(_request: unknown, ctx: RequestContext): Promise<GetPermissionMatrixResponse> {
    requireStaff(ctx);
    return { permissions: PERMISSIONS, matrix: await readMatrix(this.database.db) };
  }

  async savePermissionMatrix(
    request: SavePermissionMatrixRequest,
    ctx: RequestContext,
  ): Promise<SavePermissionMatrixResponse> {
    requireStaff(ctx, "admin");
    for (const entry of request.matrix) {
      requireRole(entry.role);
      const unknown = entry.permissionIds.find((p) => !PERMISSION_IDS.has(p));
      if (unknown) {
        throw invalidArgument("PERMISSION_UNKNOWN", `Unknown permission ${unknown}.`, {
          permission: unknown,
        });
      }
    }
    const matrix = await this.database.transaction(ctx, async (tx) => {
      for (const entry of request.matrix) {
        // Admins always have everything (the console doesn't let you edit that column).
        if (entry.role === StaffRole.STAFF_ROLE_ADMIN) continue;
        await tx.delete(rolePermissions).where(eq(rolePermissions.role, entry.role));
        const ids = [...new Set(entry.permissionIds)];
        if (ids.length) {
          await tx
            .insert(rolePermissions)
            .values(ids.map((permissionId) => ({ role: entry.role, permissionId })));
        }
      }
      return readMatrix(tx);
    });
    return { permissions: PERMISSIONS, matrix };
  }
}

function requireRole(role: StaffRole): StaffRole {
  if (!ROLES.includes(role)) {
    throw invalidArgument("STAFF_ROLE_REQUIRED", "Choose admin, ops, finance or support.", { field: "role" });
  }
  return role;
}

async function lockStaff(tx: Tx, id: string): Promise<StaffRow> {
  const [row] = await tx.select().from(staff).where(eq(staff.id, id.trim())).for("update");
  if (!row) throw notFound("STAFF_NOT_FOUND", "We couldn't find that staff member.", { staffId: id });
  return row;
}

async function assertAnotherAdmin(tx: Tx, exceptId: string): Promise<void> {
  // Lock every admin row so two concurrent demotions can't both pass the check.
  const admins = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.role, StaffRole.STAFF_ROLE_ADMIN))
    .for("update");
  if (!admins.some((a) => a.id !== exceptId)) {
    throw failedPrecondition(
      "LAST_ADMIN",
      "Kadé needs at least one admin. Make someone else an admin first.",
    );
  }
}

export async function readMatrix(db: Queryable): Promise<RolePermissions[]> {
  const rows = await db
    .select()
    .from(rolePermissions)
    .orderBy(asc(rolePermissions.role), sql`${rolePermissions.permissionId}`);
  return ROLES.map((role) => ({
    role,
    permissionIds:
      role === StaffRole.STAFF_ROLE_ADMIN
        ? PERMISSIONS.map((p) => p.id)
        : PERMISSIONS.map((p) => p.id).filter((id) =>
            rows.some((r) => r.role === role && r.permissionId === id),
          ),
  }));
}

export function staffToProto(row: StaffRow): Staff {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    title: row.title,
    lastActiveAt: row.lastActiveAt ?? undefined,
    status: row.status,
  };
}
