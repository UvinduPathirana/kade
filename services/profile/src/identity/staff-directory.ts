import type { Actor } from "@kade/proto/kade/common/v1/types";
import { eq } from "drizzle-orm";
import { staff } from "../db/schema.js";
import type { Queryable } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";

/** The caller as an Actor (for events and the audit log). */
export const actorOf = (ctx: RequestContext): Actor => ({
  userId: ctx.userId ?? "",
  roles: [...ctx.roles],
  outletId: ctx.outletId ?? "",
});

/** Display name of a staff member for "Blocked by Dilini"; "Kadé" for system callers. */
export async function staffName(db: Queryable, userId: string | undefined): Promise<string> {
  if (!userId) return "Kadé";
  const [row] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, userId));
  return row?.name ?? "Kadé ops";
}
