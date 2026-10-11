// Kitchen board over gateway-merchant (merchant KitchenService). Polled every second by the app.
import { enc, get, post } from "../http";
import type { RejectReason, Ticket } from "../types";

export const listTickets = () => get<Ticket[]>("/v1/tickets");

export const getTicket = (id: string) => get<Ticket | null>(`/v1/tickets/${enc(id)}`, { nullOn404: true });

export const acceptTicket = ({ id, prepMinutes }: { id: string; prepMinutes: number }) =>
  post<Ticket>(`/v1/tickets/${enc(id)}/accept`, { prepMinutes });

export const rejectTicket = ({ id, reason, note }: { id: string; reason: RejectReason; note: string }) =>
  post<Ticket>(`/v1/tickets/${enc(id)}/reject`, { reason, note });

export const markReady = (id: string) => post<Ticket>(`/v1/tickets/${enc(id)}/ready`);

export const handOver = (id: string) => post<Ticket>(`/v1/tickets/${enc(id)}/handover`);
