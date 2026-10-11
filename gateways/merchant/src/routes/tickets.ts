import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Ticket as ProtoTicket } from "@kade/proto/kade/merchant/v1/merchant_service";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { REJECT_FROM_APP, ticketNumberOf, toTicket } from "../mappers.js";
import { ProblemError } from "../problem.js";
import { RejectReason, Ticket, problems, ref } from "../schemas.js";
import { IdempotencyHeaders, STAFF, idempotencyKey, outletOf, security, type RouteDeps } from "./context.js";

const HEARTBEAT_EVERY_MS = 30_000;
// The board shows tickets closed within the last 90 minutes (the app's own rule).
const BOARD_WINDOW_MIN = 90;
// Ticket numbers are looked up over a day, so the ticket page works for older orders too.
const LOOKUP_WINDOW_MIN = 24 * 60;

/**
 * Kitchen board. The app knows a ticket by its short number ("2417"); services by order id. The
 * gateway keeps number -> order id per outlet from every board read, and asks again on a miss.
 */
export const ticketRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const lastHeartbeat = new Map<string, number>();

    // Per outlet: app id -> order id, and back. Ticket numbers are unique on a real board; if two
    // orders ever share one, both get the order id's tail ("4821-0a1f") so actions can't mix them up.
    const orderIds = new Map<string, Map<string, string>>();
    const appIds = new Map<string, Map<string, string>>();

    const remember = (outletId: string, tickets: ProtoTicket[]) => {
      const byApp = orderIds.get(outletId) ?? new Map<string, string>();
      const byOrder = appIds.get(outletId) ?? new Map<string, string>();
      const counts = new Map<string, number>();
      for (const t of tickets) counts.set(ticketNumberOf(t), (counts.get(ticketNumberOf(t)) ?? 0) + 1);
      for (const t of tickets) {
        const n = ticketNumberOf(t);
        const id = (counts.get(n) ?? 0) > 1 ? `${n}-${t.orderId.slice(-4)}` : n;
        byApp.set(id, t.orderId);
        byOrder.set(t.orderId, id);
      }
      orderIds.set(outletId, byApp);
      appIds.set(outletId, byOrder);
    };

    /** The app's shape, with the board's id for this order. */
    const present = (req: FastifyRequest, t: ProtoTicket | undefined, now = Date.now()) => {
      const ticket = toTicket(t, now);
      const id = t && appIds.get(outletOf(req))?.get(t.orderId);
      return id ? { ...ticket, id } : ticket;
    };

    const list = async (req: FastifyRequest, reply: FastifyReply, window: number) => {
      const outletId = outletOf(req);
      const res = await unary(
        u.kitchen.listTickets.bind(u.kitchen),
        { outletId, closedWithinMinutes: window },
        callContext(req, reply),
      );
      remember(outletId, res.tickets);
      return res.tickets;
    };

    const orderIdOf = async (req: FastifyRequest, reply: FastifyReply, ticket: string): Promise<string> => {
      const outletId = outletOf(req);
      const known = orderIds.get(outletId)?.get(ticket);
      if (known) return known;
      await list(req, reply, LOOKUP_WINDOW_MIN);
      const id = orderIds.get(outletId)?.get(ticket);
      if (!id) throw new ProblemError(404, "TICKET_NOT_FOUND", `Order #${ticket} is no longer on the board.`);
      return id;
    };

    const params = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });
    const config = { roles: STAFF };

    app.get(
      "/v1/tickets",
      {
        config,
        schema: {
          operationId: "listTickets",
          tags: ["orders"],
          summary: "The live board: open tickets plus those closed in the last 90 minutes, oldest first",
          security,
          response: { 200: Type.Array(ref(Ticket)), ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const tickets = await list(req, reply, BOARD_WINDOW_MIN);
        // The board is polled every second while the tablet is on: that is the tablet's heartbeat.
        const outletId = outletOf(req);
        const now = Date.now();
        if (now - (lastHeartbeat.get(outletId) ?? 0) > HEARTBEAT_EVERY_MS) {
          lastHeartbeat.set(outletId, now);
          unary(
            u.outlets.reportTabletHeartbeat.bind(u.outlets),
            { outletId, deviceId: req.headers["user-agent"]?.slice(0, 120) ?? "tablet" },
            { identity: req.identity, deadlineMs: 2_000 },
          ).catch((err: unknown) => req.log.debug({ err }, "heartbeat failed"));
        }
        return tickets.map((t) => present(req, t, now)).sort((a, b) => a.placedAt - b.placedAt);
      },
    );

    app.get(
      "/v1/tickets/:id",
      {
        config,
        schema: {
          operationId: "getTicket",
          tags: ["orders"],
          summary: "One ticket by its short number",
          security,
          params,
          response: { 200: ref(Ticket), ...problems(401, 403, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const orderId = await orderIdOf(req, reply, req.params.id);
        const res = await unary(
          u.kitchen.getTicket.bind(u.kitchen),
          { outletId: outletOf(req), orderId },
          callContext(req, reply),
        );
        return present(req, res.ticket);
      },
    );

    const mutation = { config, security, headers: IdempotencyHeaders, params, tags: ["orders"] };
    const answers = { 200: ref(Ticket), ...problems(400, 401, 403, 404, 409, 503, 504) };

    app.post(
      "/v1/tickets/:id/accept",
      {
        config,
        schema: {
          ...mutation,
          operationId: "acceptTicket",
          summary: "Accept with a prep time (busy-mode minutes are added by merchant)",
          body: Type.Object({ prepMinutes: Type.Integer({ minimum: 1, maximum: 120 }) }),
          response: answers,
        },
      },
      async (req, reply) => {
        const orderId = await orderIdOf(req, reply, req.params.id);
        const res = await unary(
          u.kitchen.acceptOrder.bind(u.kitchen),
          {
            outletId: outletOf(req),
            orderId,
            prepMinutes: req.body.prepMinutes,
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return present(req, res.ticket);
      },
    );

    app.post(
      "/v1/tickets/:id/reject",
      {
        config,
        schema: {
          ...mutation,
          operationId: "rejectTicket",
          summary: "Reject a new order with a reason",
          body: Type.Object({ reason: RejectReason, note: Type.String({ maxLength: 500 }) }),
          response: answers,
        },
      },
      async (req, reply) => {
        const orderId = await orderIdOf(req, reply, req.params.id);
        const res = await unary(
          u.kitchen.rejectOrder.bind(u.kitchen),
          {
            outletId: outletOf(req),
            orderId,
            reason: REJECT_FROM_APP[req.body.reason as keyof typeof REJECT_FROM_APP],
            note: req.body.note,
            idempotencyKey: idempotencyKey(req),
          },
          callContext(req, reply),
        );
        return present(req, res.ticket);
      },
    );

    app.post(
      "/v1/tickets/:id/ready",
      {
        config,
        schema: { ...mutation, operationId: "markTicketReady", summary: "Food is ready", response: answers },
      },
      async (req, reply) => {
        const orderId = await orderIdOf(req, reply, req.params.id);
        const res = await unary(
          u.kitchen.markOrderReady.bind(u.kitchen),
          { outletId: outletOf(req), orderId, idempotencyKey: idempotencyKey(req) },
          callContext(req, reply),
        );
        return present(req, res.ticket);
      },
    );

    app.post(
      "/v1/tickets/:id/handover",
      {
        config,
        schema: {
          ...mutation,
          operationId: "handOverTicket",
          summary: "Rider took the bag, or the customer collected it",
          response: answers,
        },
      },
      async (req, reply) => {
        const orderId = await orderIdOf(req, reply, req.params.id);
        const res = await unary(
          u.kitchen.handOverOrder.bind(u.kitchen),
          { outletId: outletOf(req), orderId, idempotencyKey: idempotencyKey(req) },
          callContext(req, reply),
        );
        return present(req, res.ticket);
      },
    );
  };
