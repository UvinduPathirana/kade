import { Inject, Injectable } from "@nestjs/common";
import {
  AuditRecordType,
  AuditServiceService,
  RecordAuditRequest,
  RecordAuditResponse,
  StaffStatus,
  type AuditEntry,
  type ListAuditEntriesRequest,
  type ListAuditEntriesResponse,
} from "@kade/proto/kade/identity/v1/identity_service";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { auditEntries, staff } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { IdempotencyStore } from "../platform/idempotency/idempotency.js";
import { requireStaff } from "../shared/access.js";
import { pageResponse, readPage } from "../shared/paging.js";
import { actorOf, staffName } from "./staff-directory.js";

export type AuditRow = typeof auditEntries.$inferSelect;

/**
 * kade.identity.v1.AuditService. Every staff write in any gateway is recorded here. The actor
 * defaults to the caller's identity (x-user-id / x-roles); actor_name defaults to the staff name.
 * Recording also marks that staff member active (team page "last active").
 */
@GrpcService(AuditServiceService)
@Injectable()
export class AuditGrpcService implements GrpcHandlers<AuditServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(IdempotencyStore) private readonly idempotency: IdempotencyStore,
  ) {}

  async recordAudit(request: RecordAuditRequest, ctx: RequestContext): Promise<RecordAuditResponse> {
    const action = request.action.trim();
    if (!action) throw invalidArgument("AUDIT_ACTION_REQUIRED", "action is required.", { field: "action" });
    if (request.recordType === AuditRecordType.AUDIT_RECORD_TYPE_UNSPECIFIED || request.recordType < 0) {
      throw invalidArgument("AUDIT_RECORD_TYPE_REQUIRED", "record_type is required.", {
        field: "record_type",
      });
    }
    const actor = request.actor?.userId ? request.actor : actorOf(ctx);
    return this.database.transaction(ctx, (tx) =>
      this.idempotency.run(
        tx,
        {
          scope: `RecordAudit:${actor.userId}`,
          key: request.idempotencyKey.trim(),
          request: RecordAuditRequest.encode(request).finish(),
          codec: RecordAuditResponse,
        },
        async () => {
          const actorName = request.actorName.trim() || (await staffName(tx, actor.userId || undefined));
          const [row] = await tx
            .insert(auditEntries)
            .values({
              id: uuidv7(),
              actorUserId: actor.userId,
              actorRoles: actor.roles,
              actorOutletId: actor.outletId,
              actorName,
              action,
              recordType: request.recordType,
              recordId: request.recordId.trim(),
              detail: request.detail.trim(),
            })
            .returning();
          if (actor.userId) {
            await tx
              .update(staff)
              .set({ lastActiveAt: new Date(), status: StaffStatus.STAFF_STATUS_ACTIVE })
              .where(eq(staff.id, actor.userId));
          }
          return { entry: auditToProto(row!) };
        },
      ),
    );
  }

  async listAuditEntries(
    request: ListAuditEntriesRequest,
    ctx: RequestContext,
  ): Promise<ListAuditEntriesResponse> {
    requireStaff(ctx);
    const page = readPage(request.page, 50, 200);
    const where: SQL[] = [];
    if (request.recordType !== AuditRecordType.AUDIT_RECORD_TYPE_UNSPECIFIED) {
      where.push(eq(auditEntries.recordType, request.recordType));
    }
    if (request.recordId.trim()) where.push(eq(auditEntries.recordId, request.recordId.trim()));
    if (request.actorUserId.trim()) where.push(eq(auditEntries.actorUserId, request.actorUserId.trim()));
    const filter = where.length ? and(...where) : undefined;
    const db = this.database.db;
    const rows = await db
      .select()
      .from(auditEntries)
      .where(filter)
      .orderBy(desc(auditEntries.at), desc(auditEntries.id))
      .limit(page.limit)
      .offset(page.offset);
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEntries)
      .where(filter);
    return { entries: rows.map(auditToProto), page: pageResponse(page, rows.length, n) };
  }
}

export function auditToProto(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    actor: { userId: row.actorUserId, roles: row.actorRoles, outletId: row.actorOutletId },
    actorName: row.actorName,
    action: row.action,
    recordType: row.recordType,
    recordId: row.recordId,
    detail: row.detail,
  };
}
