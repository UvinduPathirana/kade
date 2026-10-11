import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  AssignTicketRequest,
  GetTicketRequest,
  ListMacrosRequest,
  ListTicketsRequest,
  MessageAuthorKind,
  ReopenTicketRequest,
  ReplyToTicketRequest,
  RequesterKind,
  ResolutionKind,
  ResolveTicketRequest,
  SetTicketPriorityRequest,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  type Ticket as ProtoTicket,
} from "@kade/proto/kade/support/v1/support_service";
import { StaffStatus } from "@kade/proto/kade/identity/v1/identity_service";
import { Type } from "typebox";
import { badRequest, notFound, STAFF_ROLE_FROM_PROTO, type Ctx } from "../context.js";
import { personId, personUuid, restaurantNumber } from "../ids.js";
import { allPages, formatRs, mapLimit, ms, nonEmpty, PAGE } from "../lib.js";
import { REFUND_METHOD_TO_PROTO } from "../mappers/orders.js";
import { fromRupees } from "../money.js";
import { SMALL_REFUND_LIMIT } from "../permissions.js";
import { listOf, Macro, problems, ref, StaffName, Ticket, TICKET_PRIORITIES } from "../schemas.js";

const security = [{ bearer: [] }];
const tags = ["support"];
const SUPPORT_ROLES = ["support", "ops", "admin"];
const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

const CATEGORY: Record<number, Ticket["category"]> = {
  [TicketCategory.TICKET_CATEGORY_MISSING_ITEM]: "missingItem",
  [TicketCategory.TICKET_CATEGORY_WRONG_ITEM]: "wrongItem",
  [TicketCategory.TICKET_CATEGORY_LATE]: "late",
  [TicketCategory.TICKET_CATEGORY_PAYMENT]: "payment",
  [TicketCategory.TICKET_CATEGORY_RIDER]: "rider",
  [TicketCategory.TICKET_CATEGORY_ACCOUNT]: "account",
  [TicketCategory.TICKET_CATEGORY_RESTAURANT]: "restaurant",
  // The console's queue has no separate buckets for these yet.
  [TicketCategory.TICKET_CATEGORY_DAMAGED]: "wrongItem",
  [TicketCategory.TICKET_CATEGORY_NEVER_ARRIVED]: "late",
  [TicketCategory.TICKET_CATEGORY_GENERAL]: "account",
};
const PRIORITY: Record<number, Ticket["priority"]> = {
  [TicketPriority.TICKET_PRIORITY_URGENT]: "urgent",
  [TicketPriority.TICKET_PRIORITY_HIGH]: "high",
  [TicketPriority.TICKET_PRIORITY_NORMAL]: "normal",
  [TicketPriority.TICKET_PRIORITY_LOW]: "low",
};
const PRIORITY_TO_PROTO: Record<Ticket["priority"], TicketPriority> = {
  urgent: TicketPriority.TICKET_PRIORITY_URGENT,
  high: TicketPriority.TICKET_PRIORITY_HIGH,
  normal: TicketPriority.TICKET_PRIORITY_NORMAL,
  low: TicketPriority.TICKET_PRIORITY_LOW,
};
const STATUS: Record<number, Ticket["status"]> = {
  [TicketStatus.TICKET_STATUS_OPEN]: "open",
  [TicketStatus.TICKET_STATUS_PENDING]: "pending",
  [TicketStatus.TICKET_STATUS_RESOLVED]: "resolved",
};
const REQUESTER: Record<number, Ticket["requester"]["kind"]> = {
  [RequesterKind.REQUESTER_KIND_CUSTOMER]: "customer",
  [RequesterKind.REQUESTER_KIND_RIDER]: "rider",
  [RequesterKind.REQUESTER_KIND_RESTAURANT]: "restaurant",
};
const FROM: Record<number, Ticket["messages"][number]["from"]> = {
  [MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER]: "requester",
  [MessageAuthorKind.MESSAGE_AUTHOR_KIND_AGENT]: "agent",
  [MessageAuthorKind.MESSAGE_AUTHOR_KIND_SYSTEM]: "system",
};

export function toTicket(t: ProtoTicket): Ticket {
  const kind = REQUESTER[t.requester?.kind ?? 0] ?? "customer";
  const rid = t.requester?.id ?? "";
  const res = t.resolution;
  return {
    id: t.id,
    subject: t.subject,
    category: CATEGORY[t.category] ?? "account",
    priority: PRIORITY[t.priority] ?? "normal",
    requester: {
      kind,
      id: kind === "restaurant" ? String(restaurantNumber(rid)) : personId(rid),
      name: t.requester?.name ?? "",
    },
    orderId: nonEmpty(t.orderNumber || t.orderId),
    openedAt: ms(t.openedAt),
    slaDueAt: ms(t.slaDueAt),
    assigneeId: t.assigneeId ? personId(t.assigneeId) : undefined,
    status: STATUS[t.status] ?? "open",
    resolution: res?.summary
      ? res.note && !res.summary.includes(res.note)
        ? `${res.summary}. ${res.note}`
        : res.summary
      : undefined,
    messages: t.messages.map((m) => ({
      id: m.id,
      at: ms(m.at),
      from: FROM[m.from] ?? "system",
      author: m.author,
      body: m.body,
    })),
  };
}

async function getTicket(ctx: Ctx, id: string): Promise<ProtoTicket> {
  const res = await ctx.rpc(ctx.up.tickets, "getTicket", GetTicketRequest.fromPartial({ ticketId: id }));
  if (!res.ticket) throw notFound(`Ticket ${id}`);
  return res.ticket;
}

export const supportRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const roles = SUPPORT_ROLES;

  app.get(
    "/v1/tickets",
    {
      config: { roles },
      schema: {
        operationId: "listTickets",
        tags,
        security,
        summary: "The support queue with each ticket's conversation (support).",
        response: { 200: listOf(Ticket), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const list = await allPages(async (pageToken) => {
        const res = await ctx.rpc(
          ctx.up.tickets,
          "listTickets",
          ListTicketsRequest.fromPartial({ page: { pageSize: PAGE, pageToken } }),
        );
        return { items: res.tickets, next: res.page?.nextPageToken ?? "" };
      }, 5);
      // ListTickets omits messages; the console shows the conversation inline, so fetch each one.
      const full = await mapLimit(list.slice(0, 200), 8, async (t) =>
        t.messages.length
          ? t
          : ((await ctx.rpc(ctx.up.tickets, "getTicket", GetTicketRequest.fromPartial({ ticketId: t.id })))
              .ticket ?? t),
      );
      return full.map(toTicket);
    },
  );

  app.get(
    "/v1/macros",
    {
      config: { roles },
      schema: {
        operationId: "listMacros",
        tags,
        security,
        summary: "Canned replies (support).",
        response: { 200: listOf(Macro), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(ctx.up.tickets, "listMacros", ListMacrosRequest.fromPartial({}));
      return res.macros.map((m) => ({ id: m.id, title: m.title, body: m.body }));
    },
  );

  app.get(
    "/v1/staff/names",
    {
      schema: {
        operationId: "listStaffNames",
        tags,
        security,
        summary: "Active staff for the assignee picker (identity).",
        response: { 200: listOf(StaffName), ...problems(401, 403, 503, 504) },
      },
    },
    async (req) =>
      (await req.ctx.staff())
        .filter((s) => s.status === StaffStatus.STAFF_STATUS_ACTIVE)
        .map((s) => ({ id: personId(s.id), name: s.name, role: STAFF_ROLE_FROM_PROTO[s.role] ?? "support" })),
  );

  app.post(
    "/v1/tickets/:id/replies",
    {
      config: { roles },
      schema: {
        operationId: "replyToTicket",
        tags,
        security,
        summary: "Agent reply; the first one stops the SLA clock (support).",
        params: IdParams,
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
        body: Type.Object({ body: Type.String({ maxLength: 5000 }) }),
        response: { 200: ref(Ticket), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const body = req.body.body.trim();
      if (!body) throw badRequest("REPLY_EMPTY", "Write a reply before sending.");
      const res = await ctx.rpc(
        ctx.up.tickets,
        "replyToTicket",
        ReplyToTicketRequest.fromPartial({
          ticketId: req.params.id,
          agentId: ctx.identity.userId,
          agentName: await ctx.actorName(),
          body,
          idempotencyKey: req.headers["idempotency-key"] || randomUUID(),
        }),
      );
      return toTicket(res.ticket ?? (await getTicket(ctx, req.params.id)));
    },
  );

  app.put(
    "/v1/tickets/:id/assignee",
    {
      config: { roles },
      schema: {
        operationId: "assignTicket",
        tags,
        security,
        summary: "Assign to a staff member, or null to unassign (support). Audited.",
        params: IdParams,
        body: Type.Object({ assigneeId: Type.Union([Type.String(), Type.Null()]) }),
        response: { 200: ref(Ticket), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { assigneeId } = req.body;
      const uuid = assigneeId ? personUuid(assigneeId) : "";
      const res = await ctx.rpc(
        ctx.up.tickets,
        "assignTicket",
        AssignTicketRequest.fromPartial({ ticketId: req.params.id, assigneeId: uuid }),
      );
      const who = uuid ? (await ctx.staff().catch(() => [])).find((s) => s.id === uuid)?.name : undefined;
      await ctx.audit({
        action: uuid
          ? `Assigned ticket to ${who ?? res.ticket?.assigneeName ?? assigneeId}`
          : "Unassigned ticket",
        recordType: "ticket",
        recordId: req.params.id,
      });
      return toTicket(res.ticket ?? (await getTicket(ctx, req.params.id)));
    },
  );

  app.put(
    "/v1/tickets/:id/priority",
    {
      config: { roles },
      schema: {
        operationId: "setTicketPriority",
        tags,
        security,
        summary: "Change priority; the SLA due time is recomputed (support).",
        params: IdParams,
        body: Type.Object({ priority: Type.Enum(TICKET_PRIORITIES) }),
        response: { 200: ref(Ticket), ...problems(400, 401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.tickets,
        "setTicketPriority",
        SetTicketPriorityRequest.fromPartial({
          ticketId: req.params.id,
          priority: PRIORITY_TO_PROTO[req.body.priority],
        }),
      );
      return toTicket(res.ticket ?? (await getTicket(ctx, req.params.id)));
    },
  );

  app.post(
    "/v1/tickets/:id/resolve",
    {
      config: { roles },
      schema: {
        operationId: "resolveTicket",
        tags,
        security,
        summary:
          "Resolve with a refund (order), Kadé credit (profile) or nothing (support). Refunds and credit need the matching permission. Audited.",
        params: IdParams,
        headers: Type.Object({ "idempotency-key": Type.Optional(Type.String({ maxLength: 128 })) }),
        body: Type.Object({
          resolution: Type.Union([
            Type.Object({
              kind: Type.Literal("refund"),
              amount: Type.Number(),
              method: Type.Union([Type.Literal("card"), Type.Literal("credit")]),
            }),
            Type.Object({ kind: Type.Literal("credit"), amount: Type.Number() }),
            Type.Object({ kind: Type.Literal("none") }),
          ]),
          note: Type.String({ maxLength: 2000 }),
        }),
        response: { 200: ref(Ticket), ...problems(400, 401, 403, 404, 409, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const { resolution: r, note } = req.body;
      let summary = "Resolved without compensation";
      if (r.kind === "refund") {
        if (!Number.isInteger(r.amount) || r.amount <= 0)
          throw badRequest("REFUND_OUT_OF_RANGE", "Refund at least Rs 1.");
        await ctx.need(
          r.amount > SMALL_REFUND_LIMIT ? "orders.refundAny" : ["orders.refundSmall", "orders.refundAny"],
        );
        summary = `Refunded ${formatRs(r.amount)} to ${r.method === "card" ? "card" : "Kadé credit"}`;
      } else if (r.kind === "credit") {
        if (!Number.isInteger(r.amount) || r.amount <= 0 || r.amount > 5000)
          throw badRequest("CREDIT_OUT_OF_RANGE", "Credit must be between Rs 1 and Rs 5,000.");
        await ctx.need("customers.credit");
        summary = `Issued ${formatRs(r.amount)} Kadé credit`;
      }
      const res = await ctx.rpc(
        ctx.up.tickets,
        "resolveTicket",
        ResolveTicketRequest.fromPartial({
          ticketId: req.params.id,
          kind:
            r.kind === "refund"
              ? ResolutionKind.RESOLUTION_KIND_REFUND
              : r.kind === "credit"
                ? ResolutionKind.RESOLUTION_KIND_CREDIT
                : ResolutionKind.RESOLUTION_KIND_NONE,
          amount: r.kind === "none" ? undefined : fromRupees(r.amount),
          method: r.kind === "refund" ? REFUND_METHOD_TO_PROTO[r.method] : undefined,
          note,
          agentId: ctx.identity.userId,
          agentName: await ctx.actorName(),
          idempotencyKey: req.headers["idempotency-key"] || randomUUID(),
        }),
      );
      await ctx.audit({
        action: "Resolved ticket",
        recordType: "ticket",
        recordId: req.params.id,
        detail: note ? `${summary}. ${note}` : summary,
      });
      return toTicket(res.ticket ?? (await getTicket(ctx, req.params.id)));
    },
  );

  app.post(
    "/v1/tickets/:id/reopen",
    {
      config: { roles },
      schema: {
        operationId: "reopenTicket",
        tags,
        security,
        summary: "Reopen a resolved ticket (support).",
        params: IdParams,
        response: { 200: ref(Ticket), ...problems(401, 403, 404, 503, 504) },
      },
    },
    async (req) => {
      const ctx = req.ctx;
      const res = await ctx.rpc(
        ctx.up.tickets,
        "reopenTicket",
        ReopenTicketRequest.fromPartial({ ticketId: req.params.id, agentName: await ctx.actorName() }),
      );
      return toTicket(res.ticket ?? (await getTicket(ctx, req.params.id)));
    },
  );
};
