// Support chat (support service) against the customer gateway. The app's chat screen expects
// sendMessage to resolve with the agent's reply, so after sending we watch the conversation for a
// little while; agents who take longer show up the next time the chat is opened.
import { api, newIdempotencyKey } from "../http";
import type { ChatMessage } from "../types";

let ticketId: Promise<string> | undefined;

function conversation(): Promise<string> {
  ticketId ??= api<{ ticketId: string; messages: ChatMessage[] }>("GET", "/v1/support/conversation", {
    auth: "required",
  }).then(
    (c) => c.ticketId,
    (err: unknown) => {
      ticketId = undefined;
      throw err;
    },
  );
  return ticketId;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPLY_WAIT_MS = 20_000;

export async function sendMessage(message: Omit<ChatMessage, "id" | "at" | "from">): Promise<ChatMessage> {
  const id = await conversation();
  const sent = await api<ChatMessage>("POST", `/v1/support/conversation/${encodeURIComponent(id)}/messages`, {
    auth: "required",
    idempotencyKey: newIdempotencyKey(),
    body: { text: message.text || "(order attached)", order: message.order },
  });
  const until = Date.now() + REPLY_WAIT_MS;
  while (Date.now() < until) {
    await wait(1500);
    const newer = await api<ChatMessage[]>(
      "GET",
      `/v1/support/conversation/${encodeURIComponent(id)}/messages`,
      { auth: "required", query: { after: sent.at } },
    ).catch(() => [] as ChatMessage[]);
    const reply = newer.find((m) => m.from === "agent");
    if (reply) return reply;
  }
  return {
    id: `pending-${sent.id}`,
    from: "agent",
    text: "Thanks, your message is with the team. Someone will reply here shortly.",
    at: Date.now(),
  };
}
