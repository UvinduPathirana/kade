// Live updates over the gateway's /ws (proxied to the realtime service). Messages are hints: on any
// push for an order, group or chat we refetch it over REST, so a missed message costs nothing but a
// few seconds (polling carries on underneath). Connects lazily once signed in; reconnects with backoff.
import type { QueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/account/session";
import { accessToken } from "../auth";
import { API_URL } from "../config";

let socket: WebSocket | undefined;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let live = false;
const channels = new Set<string>();

interface Frame {
  type?: string;
  userId?: string;
  realtime?: boolean;
  message?: { channel?: string };
}

const wsUrl = () => `${API_URL.replace(/^http/, "ws")}/ws`;

function subscribe(list: string[]) {
  if (live && socket?.readyState === WebSocket.OPEN && list.length)
    socket.send(JSON.stringify({ subscribe: { channels: list } }));
}

/** Follow one order's channel (the tracking page). */
export function watchOrder(ref: string | undefined): () => void {
  if (!ref) return () => undefined;
  const ch = `order:${ref}`;
  channels.add(ch);
  subscribe([ch]);
  return () => {
    channels.delete(ch);
    if (live && socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ unsubscribe: { channels: [ch] } }));
  };
}

function close() {
  clearTimeout(retryTimer);
  live = false;
  const s = socket;
  socket = undefined;
  s?.close(1000, "signed out");
}

async function connect(qc: QueryClient) {
  if (socket || !useSession.getState().user) return;
  const token = await accessToken();
  if (!token) return;
  const s = new WebSocket(wsUrl());
  socket = s;
  s.onopen = () => s.send(JSON.stringify({ type: "auth", token }));
  s.onmessage = (e) => {
    let f: Frame;
    try {
      f = JSON.parse(String(e.data)) as Frame;
    } catch {
      return;
    }
    if (f.type === "ready") {
      attempt = 0;
      live = !!f.realtime;
      if (live && f.userId) subscribe([`customer:${f.userId}`, ...channels]);
      return;
    }
    const channel = f.message?.channel ?? "";
    if (channel.startsWith("order:") || channel.startsWith("customer:"))
      void qc.invalidateQueries({ queryKey: ["order"] });
    else if (channel.startsWith("group:")) void qc.invalidateQueries({ queryKey: ["group"] });
  };
  s.onclose = () => {
    if (socket !== s) return;
    socket = undefined;
    live = false;
    if (!useSession.getState().user) return;
    // Back off: 2 s, 4 s, … up to a minute (realtime may simply not be running yet).
    const delay = Math.min(60_000, 2000 * 2 ** attempt++);
    retryTimer = setTimeout(() => void connect(qc), delay);
  };
}

export function startRealtime(qc: QueryClient): void {
  void connect(qc);
  useSession.subscribe((s, prev) => {
    if (s.user && !prev.user) void connect(qc);
    if (!s.user && prev.user) close();
  });
}
