import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  HelpAudience,
  MessageAuthorKind,
  RequesterKind,
  type TicketMessage,
} from "@kade/proto/kade/support/v1/support_service";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "typebox";
import { unary } from "../grpc/call.js";
import { ChatMessage, HelpTopic, problems, ref } from "../schemas.js";
import { IdempotencyHeaders, RIDER, idempotencyKey, riderOf, security, type RouteDeps } from "./context.js";

// How long POST /v1/support/messages waits for an agent's reply before answering without one.
const REPLY_WAIT_MS = 6_000;
const REPLY_POLL_MS = 1_000;

const toChat = (m: TicketMessage) => ({
  id: m.id,
  from:
    m.from === MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER ? ("rider" as const) : ("support" as const),
  text: m.body,
  at: m.at?.getTime() ?? Date.now(),
});

/** Help topics and the rider's support chat (support service). */
export const supportRoutes =
  ({ u, callContext }: RouteDeps): FastifyPluginAsyncTypebox =>
  async (app) => {
    const config = { roles: RIDER };

    app.get(
      "/v1/support/help-topics",
      {
        config,
        schema: {
          operationId: "listHelpTopics",
          tags: ["support"],
          security,
          response: { 200: Type.Array(ref(HelpTopic)), ...problems(401, 403, 503, 504) },
        },
      },
      async (req, reply) => {
        const res = await unary(
          u.support.listHelpTopics.bind(u.support),
          { audience: HelpAudience.HELP_AUDIENCE_RIDER },
          callContext(req, reply),
        );
        return res.topics.map((t) => ({ id: t.id, title: t.title, summary: t.summary, steps: t.steps }));
      },
    );

    app.post(
      "/v1/support/messages",
      {
        config,
        schema: {
          operationId: "sendSupportMessage",
          tags: ["support"],
          security,
          summary:
            "Sends a message to rider support and waits briefly for the agent's reply " +
            "(later replies arrive over /ws on ticket:<id>)",
          headers: IdempotencyHeaders,
          body: Type.Object({ text: Type.String({ minLength: 1, maxLength: 2000 }) }),
          response: {
            200: Type.Object({ sent: ref(ChatMessage), reply: ref(ChatMessage) }),
            ...problems(400, 401, 403, 503, 504),
          },
        },
      },
      async (req, reply) => {
        const ctx = callContext(req, reply);
        const requester = {
          kind: RequesterKind.REQUESTER_KIND_RIDER,
          id: riderOf(req),
          name: req.identity?.name ?? "",
        };
        const conv = await unary(
          u.support.getOrStartConversation.bind(u.support),
          { requester, orderId: "" },
          ctx,
        );
        const ticketId = conv.ticket?.id ?? "";
        const sent = await unary(
          u.support.sendMessage.bind(u.support),
          { ticketId, requester, text: req.body.text, order: undefined, idempotencyKey: idempotencyKey(req) },
          ctx,
        );
        const sentMsg = toChat(sent.message!);
        const deadline = Date.now() + REPLY_WAIT_MS;
        while (Date.now() < deadline && !ctx.signal?.aborted) {
          await sleep(REPLY_POLL_MS);
          const list = await unary(
            u.support.listMessages.bind(u.support),
            { ticketId, page: { pageSize: 20, pageToken: "" } },
            ctx,
          ).catch(() => undefined);
          const answer = list?.messages
            .filter((m) => m.from !== MessageAuthorKind.MESSAGE_AUTHOR_KIND_REQUESTER)
            .find((m) => (m.at?.getTime() ?? 0) >= sentMsg.at);
          if (answer) return { sent: sentMsg, reply: toChat(answer) };
        }
        return {
          sent: sentMsg,
          reply: {
            id: `${sentMsg.id}-ack`,
            from: "support" as const,
            text: "Thanks, we've got your message. Someone from rider support will reply here shortly.",
            at: Date.now(),
          },
        };
      },
    );
  };
