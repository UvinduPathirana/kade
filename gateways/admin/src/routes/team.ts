import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  AuditRecordType as ProtoAuditRecordType,
  ChangeStaffRoleRequest,
  GetPermissionMatrixRequest,
  InviteStaffRequest,
  ListAuditEntriesRequest,
  SavePermissionMatrixRequest,
  StaffStatus,
  type Staff as ProtoStaff,
} from "@kade/proto/kade/identity/v1/identity_service";
import { Type } from "typebox";
import { badRequest, notFound, STAFF_ROLE_FROM_PROTO, STAFF_ROLE_TO_PROTO } from "../context.js";
import { auditRecordToConsole, personId, personUuid } from "../ids.js";
import { allPages, ms, msOpt, nonEmpty } from "../lib.js";
import {
  DEFAULT_MATRIX,
  isStaffRole,
  PERMISSIONS,
  primaryRole,
  ROLE_TITLES,
  STAFF_ROLES,
  type Matrix,
  type StaffRole,
} from "../permissions.js";
import {
  AuditEntry,
  listOf,
  Me,
  PermissionMatrix,
  Permissions,
  problems,
  ref,
  ROLES,
  Staff,
  type AuditRecordType,
} from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["team"];

const AUDIT_TYPE_FROM_PROTO: Record<number, AuditRecordType> = {
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_ORDER]: "order",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_RESTAURANT]: "restaurant",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_RIDER]: "rider",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER]: "customer",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_PAYOUT]: "payout",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_ZONE]: "zone",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_VOUCHER]: "voucher",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_TICKET]: "ticket",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_CONTENT]: "content",
  [ProtoAuditRecordType.AUDIT_RECORD_TYPE_TEAM]: "team",
};

export const toStaff = (s: ProtoStaff): Staff => {
  const role = STAFF_ROLE_FROM_PROTO[s.role] ?? "support";
  return {
    id: personId(s.id),
    name: s.name,
    email: s.email,
    role,
    title: s.title || ROLE_TITLES[role],
    lastActiveAt: msOpt(s.lastActiveAt),
    status: s.status === StaffStatus.STAFF_STATUS_INVITED ? "invited" : "active",
  };
};

const Role = Type.Enum(ROLES);

export const teamRoutes =
  (opts: { invalidateStaff: () => void; invalidateMatrix: () => void }): FastifyPluginAsyncTypebox =>
  async (app) => {
    app.get(
      "/v1/me",
      {
        schema: {
          operationId: "getMe",
          tags,
          security,
          summary: "The signed-in staff member: name, role, title and effective permissions.",
          response: { 200: ref(Me), ...problems(401, 403) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const id = ctx.identity;
        const [staff, matrix] = await Promise.all([
          ctx.staff().catch(() => [] as ProtoStaff[]),
          ctx.matrix(),
        ]);
        const record = staff.find((s) => s.id === id.userId || (!!id.email && s.email === id.email));
        const roles = id.roles.filter(isStaffRole);
        const role = primaryRole(roles) ?? "support";
        const name = id.name || record?.name || id.email || id.userId;
        const permissions = roles.includes("admin")
          ? PERMISSIONS.map((p) => p.id)
          : [...new Set(roles.flatMap((r) => matrix[r]))];
        return {
          id: personId(id.userId),
          name,
          short: name.split(" ")[0] ?? name,
          email: id.email ?? record?.email ?? "",
          role,
          roles,
          title: record?.title || ROLE_TITLES[role],
          permissions,
        };
      },
    );

    app.get(
      "/v1/team/staff",
      {
        schema: {
          operationId: "listStaff",
          tags,
          security,
          summary: "Kadé staff accounts (identity).",
          response: { 200: listOf(Staff), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        opts.invalidateStaff();
        return (await req.ctx.staff()).map(toStaff);
      },
    );

    app.get(
      "/v1/team/permissions",
      {
        schema: {
          operationId: "getPermissions",
          tags,
          security,
          summary: "Permissions and which roles have them (identity).",
          response: { 200: ref(Permissions), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const res = await ctx.rpc(
          ctx.up.staff,
          "getPermissionMatrix",
          GetPermissionMatrixRequest.fromPartial({}),
        );
        const matrix: Matrix = { ...DEFAULT_MATRIX };
        for (const row of res.matrix) {
          const role = STAFF_ROLE_FROM_PROTO[row.role];
          if (role && role !== "admin") matrix[role] = row.permissionIds;
        }
        const permissions = res.permissions.length
          ? res.permissions.map((p) => ({ id: p.id, label: p.label, group: p.group }))
          : PERMISSIONS;
        matrix.admin = permissions.map((p) => p.id);
        return { permissions, matrix };
      },
    );

    app.get(
      "/v1/audit",
      {
        schema: {
          operationId: "listAudit",
          tags,
          security,
          summary: "The audit log of staff actions, newest first (identity).",
          response: { 200: listOf(AuditEntry), ...problems(401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const entries = await allPages(async (pageToken) => {
          const res = await ctx.rpc(
            ctx.up.audit,
            "listAuditEntries",
            ListAuditEntriesRequest.fromPartial({ page: { pageSize: 200, pageToken } }),
          );
          return { items: res.entries, next: res.page?.nextPageToken ?? "" };
        }, 3);
        return entries.map((e) => {
          const recordType = AUDIT_TYPE_FROM_PROTO[e.recordType] ?? "team";
          return {
            id: e.id,
            at: ms(e.at),
            actor: e.actorName || personId(e.actor?.userId),
            action: e.action,
            recordType,
            recordId: auditRecordToConsole(recordType, e.recordId),
            detail: nonEmpty(e.detail),
          };
        });
      },
    );

    app.post(
      "/v1/team/staff",
      {
        config: { permission: "team.manage" },
        schema: {
          operationId: "inviteStaff",
          tags,
          security,
          summary: "Invite a staff member by @kade.lk email (identity). Audited.",
          body: Type.Object({
            name: Type.String({ maxLength: 120 }),
            email: Type.String({ maxLength: 200 }),
            role: Role,
          }),
          response: { 201: ref(Staff), ...problems(400, 401, 403, 409, 503, 504) },
        },
      },
      async (req, reply) => {
        const ctx = req.ctx;
        const { name, role } = req.body;
        const email = req.body.email.trim().toLowerCase();
        if (!name.trim()) throw badRequest("NAME_REQUIRED", "Enter their full name.");
        if (!/^[^@\s]+@kade\.lk$/.test(email))
          throw badRequest("EMAIL_NOT_KADE", "Use their @kade.lk work email.");
        const res = await ctx.rpc(
          ctx.up.staff,
          "inviteStaff",
          InviteStaffRequest.fromPartial({
            name: name.trim(),
            email,
            role: STAFF_ROLE_TO_PROTO[role],
            title: ROLE_TITLES[role],
          }),
        );
        if (!res.staff) throw notFound("Staff member");
        opts.invalidateStaff();
        const s = toStaff(res.staff);
        await ctx.audit({
          action: "Invited staff member",
          recordType: "team",
          recordId: s.id,
          detail: `${s.name}, ${ROLE_TITLES[role]}`,
        });
        return reply.code(201).send(s);
      },
    );

    app.put(
      "/v1/team/staff/:id/role",
      {
        config: { permission: "team.manage" },
        schema: {
          operationId: "changeRole",
          tags,
          security,
          summary: "Change a staff member's role; Kadé always keeps one admin (identity). Audited.",
          params: Type.Object({ id: Type.String({ minLength: 1 }) }),
          body: Type.Object({ role: Role }),
          response: { 200: ref(Staff), ...problems(400, 401, 403, 404, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const uuid = personUuid(req.params.id);
        const before = (await ctx.staff().catch(() => [] as ProtoStaff[])).find((s) => s.id === uuid);
        const res = await ctx.rpc(
          ctx.up.staff,
          "changeStaffRole",
          ChangeStaffRoleRequest.fromPartial({ staffId: uuid, role: STAFF_ROLE_TO_PROTO[req.body.role] }),
        );
        if (!res.staff) throw notFound("Staff member");
        opts.invalidateStaff();
        const s = toStaff(res.staff);
        const was = before ? ROLE_TITLES[STAFF_ROLE_FROM_PROTO[before.role] ?? "support"] : "their old role";
        await ctx.audit({
          action: `Changed role from ${was} to ${ROLE_TITLES[req.body.role]}`,
          recordType: "team",
          recordId: s.id,
          detail: s.name,
        });
        return s;
      },
    );

    app.put(
      "/v1/team/permissions",
      {
        config: { permission: "team.manage" },
        schema: {
          operationId: "savePermissions",
          tags,
          security,
          summary: "Replace the role → permission matrix; admin always has everything (identity). Audited.",
          body: ref(PermissionMatrix),
          response: { 200: ref(PermissionMatrix), ...problems(400, 401, 403, 503, 504) },
        },
      },
      async (req) => {
        const ctx = req.ctx;
        const next = req.body;
        const known = new Set(PERMISSIONS.map((p) => p.id));
        const before = await ctx.matrix();
        const editable = STAFF_ROLES.filter((r): r is Exclude<StaffRole, "admin"> => r !== "admin");
        const res = await ctx.rpc(
          ctx.up.staff,
          "savePermissionMatrix",
          SavePermissionMatrixRequest.fromPartial({
            matrix: editable.map((role) => ({
              role: STAFF_ROLE_TO_PROTO[role],
              permissionIds: next[role].filter((p) => known.has(p)),
            })),
          }),
        );
        opts.invalidateMatrix();
        const changes: string[] = [];
        for (const role of editable) {
          const b = new Set(before[role]);
          const a = new Set(next[role]);
          const added = [...a].filter((p) => !b.has(p)).length;
          const removed = [...b].filter((p) => !a.has(p)).length;
          if (added || removed) changes.push(`${ROLE_TITLES[role]}: ${added} added, ${removed} removed`);
        }
        if (changes.length)
          await ctx.audit({
            action: "Changed role permissions",
            recordType: "team",
            recordId: "roles",
            detail: changes.join("; "),
          });
        const saved: Matrix = { ...DEFAULT_MATRIX, admin: PERMISSIONS.map((p) => p.id) };
        for (const row of res.matrix) {
          const role = STAFF_ROLE_FROM_PROTO[row.role];
          if (role && role !== "admin") saved[role] = row.permissionIds;
        }
        if (!res.matrix.length) for (const role of editable) saved[role] = next[role];
        return saved;
      },
    );
  };
