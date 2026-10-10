// Support chat. Later: the support service's chat socket, with a person on the other end.
// Today a scripted agent answers by keyword so the conversation can be tried end to end.
import { formatRs } from "@kade/ui";
import type { ChatMessage } from "./types";

export const AGENT = { name: "Tharushi", team: "Kadé support" };

const latency = (ms: number) => new Promise((r) => setTimeout(r, ms));

const id = () => `m${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** First message in every new conversation. */
export function greeting(firstName?: string): ChatMessage {
  return {
    id: "m0",
    from: "agent",
    text: `Hi${firstName ? ` ${firstName}` : ""}, I'm ${AGENT.name} from ${AGENT.team}. What can I help with? If it's about an order, attach it and I'll have the details in front of me.`,
    at: Date.now(),
  };
}

function answer(message: ChatMessage): string {
  const t = message.text.toLowerCase();
  const order = message.order;
  if (order && /missing|wrong|spill|cold|refund/.test(t))
    return `Sorry about order ${order.id}. The quickest way is "Get help with this order" on its receipt: pick the dishes affected and the credit lands straight away. If you'd rather, tell me which dishes and I'll sort it here.`;
  if (/where|late|track|long|waiting/.test(t))
    return order
      ? `I can see order ${order.id} from ${order.restaurant}. The live map on the order page updates every few seconds. If it's more than 15 minutes past the time shown, say so and I'll call the rider.`
      : "Attach the order and I'll check where the rider is. You can also follow it live from Orders.";
  if (/refund|credit|money back|charged/.test(t))
    return `Refunds to Kadé credit are instant. Refunds to a card take 5 to 7 working days to show, depending on your bank.${order ? ` Order ${order.id} came to ${formatRs(order.total)}.` : ""}`;
  if (/address|location|pin|deliver to/.test(t))
    return "You can change the address from the top of any page until the restaurant accepts. After that, tell me the new address and I'll check with the rider.";
  if (/cancel/.test(t))
    return "You can cancel from the order page until the kitchen accepts it, usually within a minute. After that, tell me what's happened and I'll see what I can do.";
  if (/\b(thanks?|ok|okay|great|sorted)\b/.test(t))
    return "Glad that's sorted. I'm here if anything else comes up.";
  if (order)
    return `Thanks, I have order ${order.id} from ${order.restaurant} open. What went wrong with it?`;
  return "Thanks. Tell me a bit more and, if it's about an order, attach it so I can see the details.";
}

/** The customer's message as it appears in the conversation straight away, before the reply. */
export const outgoing = (message: Pick<ChatMessage, "text" | "order">): ChatMessage => ({
  ...message,
  id: id(),
  from: "you",
  at: Date.now(),
});

/** Sends a message and resolves with the agent's reply. */
export async function sendMessage(message: Omit<ChatMessage, "id" | "at" | "from">): Promise<ChatMessage> {
  const sent: ChatMessage = { ...message, id: id(), at: Date.now(), from: "you" };
  await latency(1400);
  return { id: id(), from: "agent", text: answer(sent), at: Date.now() };
}
