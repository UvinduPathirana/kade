// Promos, the server-side cart copy, group orders and the support chat.
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Cart as PbCart } from "@kade/proto/kade/cart/v1/cart_service";
import { RequesterKind } from "@kade/proto/kade/support/v1/support_service";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { toChatMessage } from "../mappers/account.js";
import { restaurantNumber } from "../mappers/ids.js";
import { fromMode, toGroup, toLine, toMode } from "../mappers/orders.js";
import { fromRupees, toRupees } from "../money.js";
import {
  Cart,
  CartInput,
  ChatMessage,
  Conversation,
  CreateGroupInput,
  GroupOrder,
  PromoCheckInput,
  PromoResult,
  PublicPromo,
  SendChatInput,
  problems,
  ref,
  refAs,
  type Cart as CartT,
  type ChatMessage as ChatMessageT,
  type GroupOrder as GroupOrderT,
  type OrderLine,
} from "../schemas.js";
import {
  bearer,
  httpError,
  idempotencyKey,
  requireIdentity,
  restaurantIdOr404,
  type RouteDeps,
} from "./context.js";
import { lineInputs } from "./orders.js";

export const commerceRoutes =
  ({ up, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const ctx = (req: FastifyRequest, reply: FastifyReply) => callContext(req, reply);

    // ---------- Promos (promotion) ----------

    app.get(
      "/v1/promos",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "listPromos",
          tags: ["promos"],
          summary: "Codes anyone can use right now, for the offers page",
          response: { 200: Type.Array(ref(PublicPromo)), ...problems(503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.promotion.listPublicPromos.bind(up.promotion),
          { customerId: req.identity?.userId ?? "" },
          ctx(req, reply),
        );
        return res.promos.map((p) => ({ code: p.code, label: p.label, detail: p.detail }));
      },
    );

    app.post(
      "/v1/promos/validate",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "validatePromo",
          tags: ["promos"],
          summary: "Checks a code against a basket without reserving anything",
          body: ref(PromoCheckInput),
          response: { 200: ref(PromoResult), ...problems(400, 503, 504) },
        },
      },
      async (req, reply) => {
        const code = req.body.code.trim().toUpperCase();
        if (!code) return { ok: false, error: "Enter a promo code." };
        const res = await unary(
          up.promotion.validatePromo.bind(up.promotion),
          {
            code,
            customerId: req.identity?.userId ?? "",
            basket: {
              restaurantId: restaurantIdOr404(req.body.restaurantId),
              lines: [],
              subtotal: fromRupees(req.body.subtotal),
              saving: undefined,
              deliveryFee: undefined,
              mode: fromMode(req.body.mode ?? "delivery"),
            },
          },
          ctx(req, reply),
        );
        const r = res.result;
        if (!r?.ok) return { ok: false, error: r?.message || `${code} can't be used on this order.` };
        return { ok: true, code: r.code || code, label: r.label, discount: toRupees(r.discount) };
      },
    );

    // ---------- Cart (server copy; the app keeps its own store and syncs it here) ----------

    async function toCart(req: FastifyRequest, reply: FastifyReply, c: PbCart | undefined): Promise<CartT> {
      const mode = toMode(c?.options?.mode ?? 0);
      if (!c || !c.restaurantId || !c.lines.length) return { restaurant: null, lines: [], mode };
      const r = await unary(
        up.catalog.getRestaurant.bind(up.catalog),
        { id: c.restaurantId, deliverTo: undefined },
        ctx(req, reply),
      ).then(
        (res) => res.restaurant,
        () => undefined,
      );
      const lines: OrderLine[] = c.lines.map((l) =>
        toLine({ ...l, sectionId: "", options: l.options, choiceNames: l.choiceNames }),
      );
      const out: CartT = {
        restaurant: {
          id: restaurantNumber(c.restaurantId),
          name: r?.name ?? c.restaurantName,
          imageId: r?.imageId ?? "",
          eta: [r?.etaMinMinutes ?? 0, r?.etaMaxMinutes ?? 0],
          deliveryFee: r ? toRupees(r.deliveryFee) : 0,
          area: r?.area ?? "",
          ...(r && r.discountPercent > 0 ? { discountPercent: r.discountPercent } : {}),
        },
        lines,
        mode,
      };
      if (c.groupId) out.groupId = c.groupId;
      return out;
    }

    app.get(
      "/v1/cart",
      {
        schema: {
          operationId: "getCart",
          tags: ["cart"],
          security: bearer,
          response: { 200: refAs<CartT>(Cart), ...problems(401, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.cart.getCart.bind(up.cart),
          { customerId: requireIdentity(req).userId },
          ctx(req, reply),
        );
        return toCart(req, reply, res.cart);
      },
    );

    app.put(
      "/v1/cart",
      {
        schema: {
          operationId: "replaceCart",
          tags: ["cart"],
          summary: "Replaces the server cart with the app's (signed-in sync)",
          security: bearer,
          body: refAs<{ restaurantId: number | null; lines: OrderLine[]; mode: "delivery" | "pickup" }>(
            CartInput,
          ),
          response: { 200: refAs<CartT>(Cart), ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const customerId = requireIdentity(req).userId;
        const { restaurantId, lines, mode } = req.body;
        let cart = (await unary(up.cart.clearCart.bind(up.cart), { customerId }, ctx(req, reply))).cart;
        if (restaurantId !== null && lines.length) {
          const rid = restaurantIdOr404(restaurantId);
          const menu = lines.some((l) => l.choices.length)
            ? (await unary(up.catalog.getMenu.bind(up.catalog), { restaurantId: rid }, ctx(req, reply))).menu
            : {
                restaurantId: rid,
                sections: [],
                popular: [],
                optionGroups: [],
                version: 0,
                updatedAt: undefined,
              };
          if (!menu) throw httpError(404, "RESTAURANT_NOT_FOUND", "We couldn't find that restaurant.");
          for (const l of lineInputs(menu, lines)) {
            cart = (
              await unary(
                up.cart.addCartLine.bind(up.cart),
                {
                  customerId,
                  restaurantId: rid,
                  itemId: l.itemId,
                  quantity: l.quantity,
                  options: l.options,
                  note: l.note,
                  replaceCart: true,
                },
                ctx(req, reply),
              )
            ).cart;
          }
        }
        if (cart && toMode(cart.options?.mode ?? 0) !== mode) {
          cart = (
            await unary(
              up.cart.updateCheckoutOptions.bind(up.cart),
              {
                customerId,
                options: {
                  ...(cart.options ?? emptyOptions),
                  mode: fromMode(mode),
                },
              },
              ctx(req, reply),
            )
          ).cart;
        }
        return toCart(req, reply, cart);
      },
    );

    // ---------- Group orders (order) ----------

    app.post(
      "/v1/groups",
      {
        schema: {
          operationId: "createGroup",
          tags: ["groups"],
          security: bearer,
          body: ref(CreateGroupInput),
          response: { 201: refAs<GroupOrderT>(GroupOrder), ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const b = req.body;
        const res = await unary(
          up.group.createGroupOrder.bind(up.group),
          {
            hostCustomerId: requireIdentity(req).userId,
            hostName: b.hostName.trim() || "You",
            restaurantId: restaurantIdOr404(b.restaurantId),
            minutes: b.minutes,
            limit: b.limit ? fromRupees(b.limit) : undefined,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          ctx(req, reply),
        );
        if (!res.group) throw new Error("order returned no group");
        return reply.code(201).send(toGroup(res.group));
      },
    );

    app.get(
      "/v1/groups/:id",
      {
        config: { auth: "optional" },
        schema: {
          operationId: "getGroup",
          tags: ["groups"],
          params: Type.Object({
            id: Type.String({ maxLength: 64, description: "Group id or share token." }),
          }),
          response: { 200: refAs<GroupOrderT>(GroupOrder), ...problems(404, 503, 504) },
        },
      },
      async (req, reply) => {
        const id = req.params.id;
        const byId = /^[0-9a-f-]{36}$/i.test(id);
        const res = await unary(
          up.group.getGroupOrder.bind(up.group),
          { groupId: byId ? id : "", shareToken: byId ? "" : id },
          ctx(req, reply),
        );
        if (!res.group)
          throw httpError(404, "GROUP_CLOSED", "This group order doesn't exist, or the host has closed it.");
        return toGroup(res.group);
      },
    );

    // ---------- Support chat (support) ----------

    const requester = (req: FastifyRequest) => {
      const id = requireIdentity(req);
      return { kind: RequesterKind.REQUESTER_KIND_CUSTOMER, id: id.userId, name: id.name ?? "" };
    };

    app.get(
      "/v1/support/conversation",
      {
        schema: {
          operationId: "getConversation",
          tags: ["support"],
          summary: "The customer's open chat (started with a greeting if there is none)",
          security: bearer,
          response: {
            200: refAs<{ ticketId: string; messages: ChatMessageT[] }>(Conversation),
            ...problems(401, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const res = await unary(
          up.support.getOrStartConversation.bind(up.support),
          { requester: requester(req), orderId: "" },
          ctx(req, reply),
        );
        const t = res.ticket;
        if (!t) throw new Error("support returned no conversation");
        let messages = t.messages;
        if (!messages.length) {
          messages = (
            await unary(
              up.support.listMessages.bind(up.support),
              { ticketId: t.id, page: { pageSize: 100, pageToken: "" } },
              ctx(req, reply),
            )
          ).messages;
        }
        return { ticketId: t.id, messages: messages.map(toChatMessage) };
      },
    );

    app.get(
      "/v1/support/conversation/:ticketId/messages",
      {
        schema: {
          operationId: "listMessages",
          tags: ["support"],
          summary: "Messages in the chat, oldest first (poll for agent replies, or use /ws ticket:<id>)",
          security: bearer,
          params: Type.Object({ ticketId: Type.String({ maxLength: 64 }) }),
          querystring: Type.Object({ after: Type.Optional(Type.Number({ description: "Epoch ms" })) }),
          response: { 200: Type.Array(ref(ChatMessage)), ...problems(401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        requireIdentity(req);
        const res = await unary(
          up.support.listMessages.bind(up.support),
          { ticketId: req.params.ticketId, page: { pageSize: 100, pageToken: "" } },
          ctx(req, reply),
        );
        const after = req.query.after ?? 0;
        return res.messages
          .map(toChatMessage)
          .filter((m) => m.at > after)
          .sort((a, b) => a.at - b.at);
      },
    );

    app.post(
      "/v1/support/conversation/:ticketId/messages",
      {
        schema: {
          operationId: "sendMessage",
          tags: ["support"],
          security: bearer,
          params: Type.Object({ ticketId: Type.String({ maxLength: 64 }) }),
          body: ref(SendChatInput),
          response: { 201: ref(ChatMessage), ...problems(400, 401, 404, 503, 504) },
        },
      },
      async (req, reply) => {
        const o = req.body.order;
        const res = await unary(
          up.support.sendMessage.bind(up.support),
          {
            ticketId: req.params.ticketId,
            requester: requester(req),
            text: req.body.text,
            order: o
              ? {
                  orderId: /^[0-9a-f-]{36}$/i.test(o.id) ? o.id : "",
                  orderNumber: /^[0-9a-f-]{36}$/i.test(o.id) ? "" : o.id,
                  restaurantName: o.restaurant,
                  total: fromRupees(o.total),
                }
              : undefined,
            idempotencyKey: idempotencyKey(req, randomUUID()),
          },
          ctx(req, reply),
        );
        if (!res.message) throw new Error("support returned no message");
        return reply.code(201).send(toChatMessage(res.message));
      },
    );
  };

const emptyOptions = {
  mode: 0,
  address: undefined,
  riderNote: "",
  kitchenNote: "",
  cutlery: false,
  scheduledFor: undefined,
  payment: undefined,
  promoCode: "",
  tip: undefined,
  useCredit: false,
  substitution: 0,
};
