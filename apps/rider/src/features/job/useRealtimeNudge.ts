import { useEffect } from "react";
import { API_URL, isLive } from "@/api/config";
import { accessToken } from "@/auth/auth";
import { useJob } from "./store";

const RETRY_MS = [1_000, 3_000, 10_000, 30_000];

/**
 * Live mode: gateway-rider's /ws relays dispatch's pushes for this rider (realtime service). Any
 * offer push makes the dispatch loop ask for the offer right away instead of at its next poll; the
 * poll stays the source of truth, so a dead socket only costs a few seconds. A job push (e.g. the
 * kitchen marked the food ready) makes useJobSync refetch the job the same way.
 */
export function useRealtimeNudge() {
  const online = useJob((s) => s.phase !== "offline");

  useEffect(() => {
    if (!isLive || !online) return;
    let socket: WebSocket | undefined;
    let timer: number | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = async () => {
      const token = await accessToken().catch(() => null);
      if (stopped || !token) return;
      socket = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: "auth", token }));
      socket.onmessage = (e) => {
        let frame: {
          type?: string;
          realtime?: boolean;
          message?: { riderOffer?: unknown; riderJob?: unknown };
        };
        try {
          frame = JSON.parse(String(e.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.type === "ready") {
          attempt = 0;
          // Realtime not running: nothing will be pushed, the poll carries on alone.
          if (!frame.realtime) socket?.close(1000, "no realtime");
          return;
        }
        if (frame.message?.riderOffer !== undefined) {
          const s = useJob.getState();
          if (s.phase === "online") useJob.setState({ nextOfferAt: Date.now() });
        }
        if (frame.message?.riderJob !== undefined) useJob.setState({ jobNudgeAt: Date.now() });
      };
      socket.onclose = (e) => {
        if (stopped || e.code === 1000 || e.code === 4401) return;
        timer = window.setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
      };
    };
    void connect();
    const ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(ping);
      socket?.close(1000, "offline");
    };
  }, [online]);
}
