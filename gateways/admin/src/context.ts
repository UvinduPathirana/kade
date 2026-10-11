// Per-request plumbing for the console routes: typed RPCs with the caller's identity, the caller's
// display name, permission checks against identity's matrix, audit entries, and the small cached
// lookups (zones, outlets, staff) that most mappers join against.
import { randomUUID } from "node:crypto";
import type { Zone as PricingZone } from "@kade/proto/kade/pricing/v1/pricing_service";
import { ListZonesRequest } from "@kade/proto/kade/pricing/v1/pricing_service";
import { ListOutletsRequest, type OutletAdminView } from "@kade/proto/kade/merchant/v1/merchant_service";
import {
  AuditRecordType as ProtoAuditRecordType,
  GetPermissionMatrixRequest,
  ListStaffRequest,
  RecordAuditRequest,
  StaffRole as ProtoStaffRole,
  type Staff as ProtoStaff,
} from "@kade/proto/kade/identity/v1/identity_service";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import type { Identity } from "./auth.js";
import type { Config } from "./config.js";
import { rpcFor, type CallContext, type Rpc } from "./grpc/call.js";
import type { Upstreams } from "./grpc/clients.js";
import { auditRecordToService } from "./ids.js";
import { allPages, Cached, PAGE } from "./lib.js";
import {
  allows,
  DEFAULT_MATRIX,
  isStaffRole,
  PERMISSIONS,
  type Matrix,
  type StaffRole,
} from "./permissions.js";
import type { AuditRecordType } from "./schemas.js";

export interface Ctx {
  rpc: Rpc;
  up: Upstreams;
  identity: Identity;
  log: FastifyBaseLogger;
  /** Staff display name for "by" fields and audit ("Dilini Perera"). */
  actorName(): Promise<string>;
  /** Throws 403 unless the caller has one of the permissions. */
  need(permission: string | string[]): Promise<void>;
  /** Appends to identity's audit log. Never throws: the change already happened. */
  audit(entry: {
    action: string;
    recordType: AuditRecordType;
    recordId: string;
    detail?: string;
  }): Promise<void>;
  zones(): Promise<PricingZone[]>;
  outlets(): Promise<OutletAdminView[]>;
  staff(): Promise<ProtoStaff[]>;
  matrix(): Promise<Matrix>;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const forbidden = () => new HttpError(403, "PERMISSION_DENIED", "You do not have access to this.");
export const badRequest = (code: string, message: string) => new HttpError(400, code, message);
export const notFound = (what: string) =>
  new HttpError(404, "NOT_FOUND", `${what} not found. Refresh the page and try again.`);

const AUDIT_TYPES: Record<AuditRecordType, ProtoAuditRecordType> = {
  order: ProtoAuditRecordType.AUDIT_RECORD_TYPE_ORDER,
  restaurant: ProtoAuditRecordType.AUDIT_RECORD_TYPE_RESTAURANT,
  rider: ProtoAuditRecordType.AUDIT_RECORD_TYPE_RIDER,
  customer: ProtoAuditRecordType.AUDIT_RECORD_TYPE_CUSTOMER,
  payout: ProtoAuditRecordType.AUDIT_RECORD_TYPE_PAYOUT,
  zone: ProtoAuditRecordType.AUDIT_RECORD_TYPE_ZONE,
  voucher: ProtoAuditRecordType.AUDIT_RECORD_TYPE_VOUCHER,
  ticket: ProtoAuditRecordType.AUDIT_RECORD_TYPE_TICKET,
  content: ProtoAuditRecordType.AUDIT_RECORD_TYPE_CONTENT,
  team: ProtoAuditRecordType.AUDIT_RECORD_TYPE_TEAM,
};

export const STAFF_ROLE_FROM_PROTO: Record<number, StaffRole | undefined> = {
  [ProtoStaffRole.STAFF_ROLE_ADMIN]: "admin",
  [ProtoStaffRole.STAFF_ROLE_OPS]: "ops",
  [ProtoStaffRole.STAFF_ROLE_FINANCE]: "finance",
  [ProtoStaffRole.STAFF_ROLE_SUPPORT]: "support",
};
export const STAFF_ROLE_TO_PROTO: Record<StaffRole, ProtoStaffRole> = {
  admin: ProtoStaffRole.STAFF_ROLE_ADMIN,
  ops: ProtoStaffRole.STAFF_ROLE_OPS,
  finance: ProtoStaffRole.STAFF_ROLE_FINANCE,
  support: ProtoStaffRole.STAFF_ROLE_SUPPORT,
};

/** Builds a Ctx for a request. Lookups are cached per process and shared by every request. */
export function createContextFactory(deps: { config: Config; up: Upstreams }) {
  const { config, up } = deps;
  const caches = {
    zones: new Cached<PricingZone[]>(60_000),
    outlets: new Cached<OutletAdminView[]>(30_000),
    staff: new Cached<ProtoStaff[]>(60_000),
    matrix: new Cached<Matrix>(30_000),
  };

  const factory = (req: FastifyRequest, reply: FastifyReply): Ctx => {
    // Client went away before we answered: cancel upstream calls instead of finishing them.
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    const identity = req.identity!;
    const call: CallContext = { identity, deadlineMs: config.GRPC_DEADLINE_MS, signal: controller.signal };
    const rpc = rpcFor(call);
    // Lookups and audit are not tied to this request's lifetime.
    const bg = rpcFor({ identity, deadlineMs: config.GRPC_DEADLINE_MS });

    const ctx: Ctx = {
      rpc,
      up,
      identity,
      log: req.log,
      zones: () =>
        caches.zones.get(
          async () => (await bg(up.pricing, "listZones", ListZonesRequest.fromPartial({}))).zones,
        ),
      outlets: () =>
        caches.outlets.get(() =>
          allPages(async (pageToken) => {
            const res = await bg(
              up.outlets,
              "listOutlets",
              ListOutletsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
            );
            return { items: res.outlets, next: res.page?.nextPageToken ?? "" };
          }),
        ),
      staff: () =>
        caches.staff.get(
          async () => (await bg(up.staff, "listStaff", ListStaffRequest.fromPartial({}))).staff,
        ),
      matrix: () =>
        caches.matrix
          .get(async () => {
            const res = await bg(up.staff, "getPermissionMatrix", GetPermissionMatrixRequest.fromPartial({}));
            const m: Matrix = { ...DEFAULT_MATRIX };
            for (const row of res.matrix) {
              const role = STAFF_ROLE_FROM_PROTO[row.role];
              if (role && role !== "admin") m[role] = row.permissionIds;
            }
            return m;
          })
          .catch((err: unknown) => {
            req.log.warn({ err: (err as Error).message }, "permission matrix unavailable; using defaults");
            return DEFAULT_MATRIX;
          }),
      async actorName() {
        if (identity.name) return identity.name;
        const s = await ctx.staff().catch(() => []);
        return s.find((x) => x.id === identity.userId)?.name ?? identity.userId;
      },
      async need(permission) {
        if (!allows(await ctx.matrix(), identity.roles, permission)) throw forbidden();
      },
      async audit(entry) {
        try {
          await bg(
            up.audit,
            "recordAudit",
            RecordAuditRequest.fromPartial({
              actor: { userId: identity.userId, roles: identity.roles },
              actorName: await ctx.actorName(),
              action: entry.action,
              recordType: AUDIT_TYPES[entry.recordType],
              recordId: auditRecordToService(entry.recordType, entry.recordId),
              detail: entry.detail ?? "",
              idempotencyKey: randomUUID(),
            }),
          );
        } catch (err) {
          req.log.error({ err: (err as Error).message, entry }, "audit entry not recorded");
        }
      },
    };
    return ctx;
  };

  return Object.assign(factory, {
    invalidate: (what: keyof typeof caches) => caches[what].invalidate(),
  });
}

export type ContextFactory = ReturnType<typeof createContextFactory>;

export { PERMISSIONS, isStaffRole };
