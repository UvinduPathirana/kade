// Support service: help topics and rider support chat. Today canned replies; later the support
// ticketing service (POST /support/conversations/:id/messages, replies streamed back).
import { helpTopics, supportPhone } from "./mock/data";
import { latency } from "./rider";
import type { ChatMessage, HelpTopic } from "./types";

export { supportPhone };

export async function listHelpTopics(): Promise<HelpTopic[]> {
  await latency(150);
  return helpTopics;
}

const replies = [
  "Thanks, Nimal. I'm looking at your trip now.",
  "Got it. I've noted it on the order and let the customer know.",
  "Done. Anything else I can help with?",
];

let turn = 0;

/** Sends a message and resolves with support's reply. */
export async function sendSupportMessage(text: string): Promise<{ sent: ChatMessage; reply: ChatMessage }> {
  await latency(250);
  const now = Date.now();
  const sent: ChatMessage = { id: `m-${now}`, from: "rider", text, at: now };
  await latency(1400);
  const reply: ChatMessage = {
    id: `m-${now}-r`,
    from: "support",
    text: replies[turn++ % replies.length]!,
    at: Date.now(),
  };
  return { sent, reply };
}

/** Quick replies to the customer go through the dispatch service's masked messaging. */
export async function messageCustomer(_input: { jobId: string; text: string }): Promise<void> {
  void _input;
  await latency(250);
}
