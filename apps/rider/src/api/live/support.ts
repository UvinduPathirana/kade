// Help topics and rider support chat (support service) and masked messages to the customer
// (dispatch) over gateway-rider.
import { enc, get, post } from "../http";
import type { ChatMessage, HelpTopic } from "../types";

export const listHelpTopics = () => get<HelpTopic[]>("/v1/support/help-topics");

/** Sends a message and resolves with support's reply (or an acknowledgement while agents are busy). */
export const sendSupportMessage = (text: string) =>
  post<{ sent: ChatMessage; reply: ChatMessage }>("/v1/support/messages", { text });

export async function messageCustomer(input: { jobId: string; text: string }): Promise<void> {
  await post(`/v1/jobs/${enc(input.jobId)}/messages`, { text: input.text });
}
