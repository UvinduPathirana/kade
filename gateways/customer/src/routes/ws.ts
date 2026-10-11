import type { FastifyPluginAsync } from "fastify";
import type { WebSocket as WsSocket } from "ws";
import { AuthError, type Authenticator, type Identity } from "../auth.js";
import type { Hub, ServerMessage } from "../hub.js";

const AUTH_TIMEOUT_MS = 5_000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 3_000;
const CLOSE_UNAUTHORIZED = 4401;
/** 1013 "try again later": the app reconnects with backoff and refetches over REST. */
const CLOSE_TRY_AGAIN = 1013;

export interface WsDeps {
  authenticator: Authenticator;
  hub: Hub;
  /** realtime's WebSocket, e.g. ws://realtime:8112/ws. */
  realtimeUrl: string;
  /** Injectable for tests; defaults to Node's built-in WebSocket client (undici). */
  connectUpstream?: (url: string, headers: Record<string, string>) => UpstreamSocket;
}

/** The slice of the WHATWG WebSocket we use for the upstream leg. */
export interface UpstreamSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "close" | "error", fn: () => void): void;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
}

const defaultConnect = (url: string, headers: Record<string, string>): UpstreamSocket =>
  // Node's WebSocket (undici) accepts headers as a non-standard init option.
  new globalThis.WebSocket(url, { headers } as unknown as string[]) as unknown as UpstreamSocket;

/**
 * GET /ws: authenticate, then a transparent proxy to the realtime service.
 *
 * Browsers cannot set headers on a WebSocket, and tokens in URLs end up in logs, so the first
 * message must be {"type":"auth","token":"<access token>"}. The gateway validates it and opens the
 * upstream socket with x-user-id / x-roles headers (realtime authorises each Subscribe against them).
 * Then frames flow unchanged both ways: proto3-JSON ClientFrame / ServerFrame
 * (proto/kade/realtime/v1). {"type":"ping"} is answered here with {"type":"pong"}.
 *
 * The upstream is connected lazily (per socket, after auth). When realtime is down the client still
 * gets {"type":"ready","realtime":false} and keeps polling REST; if realtime drops later the socket
 * closes with 1013 so the client reconnects.
 */
export const wsRoutes =
  ({ authenticator, hub, realtimeUrl, connectUpstream = defaultConnect }: WsDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/ws", { websocket: true, schema: { hide: true }, config: { auth: "public" } }, (socket, req) => {
      let identity: Identity | undefined;
      let upstream: UpstreamSocket | undefined;
      let upstreamOpen = false;
      const pending: string[] = [];
      const send = (m: ServerMessage): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      };
      const reject = (s: WsSocket, reason: string): void => s.close(CLOSE_UNAUTHORIZED, reason);
      const timer = setTimeout(() => reject(socket, "auth timeout"), AUTH_TIMEOUT_MS);

      const openUpstream = (id: Identity): void => {
        let settled = false;
        const unavailable = (): void => {
          if (settled) return;
          settled = true;
          req.log.info({ realtimeUrl }, "realtime unavailable; client falls back to polling");
          send({ type: "ready", userId: id.userId, realtime: false });
          send({ type: "error", code: "REALTIME_UNAVAILABLE", message: "Live updates are paused." });
        };
        let up: UpstreamSocket;
        try {
          up = connectUpstream(realtimeUrl, {
            "x-user-id": id.userId,
            "x-roles": id.roles.join(","),
            ...(id.outletId ? { "x-outlet-id": id.outletId } : {}),
          });
        } catch (err) {
          req.log.warn({ err }, "realtime connect failed");
          return unavailable();
        }
        upstream = up;
        const giveUp = setTimeout(() => {
          if (!settled) {
            unavailable();
            up.close();
          }
        }, UPSTREAM_CONNECT_TIMEOUT_MS);
        up.addEventListener("open", () => {
          clearTimeout(giveUp);
          if (settled) return up.close();
          settled = true;
          upstreamOpen = true;
          send({ type: "ready", userId: id.userId, realtime: true });
          for (const m of pending.splice(0)) up.send(m);
        });
        up.addEventListener("message", (e) => {
          if (socket.readyState === socket.OPEN)
            socket.send(typeof e.data === "string" ? e.data : String(e.data));
        });
        up.addEventListener("error", () => {
          clearTimeout(giveUp);
          unavailable();
        });
        up.addEventListener("close", () => {
          clearTimeout(giveUp);
          const wasOpen = upstreamOpen;
          upstreamOpen = false;
          upstream = undefined;
          if (wasOpen && socket.readyState === socket.OPEN)
            socket.close(CLOSE_TRY_AGAIN, "realtime restarting");
          else unavailable();
        });
      };

      socket.on("message", (raw) => {
        const text = raw.toString();
        let msg: { type?: unknown; token?: unknown };
        try {
          msg = JSON.parse(text) as typeof msg;
        } catch {
          return send({ type: "error", code: "BAD_MESSAGE", message: "Messages are JSON objects." });
        }
        if (!identity) {
          if (msg.type !== "auth" || typeof msg.token !== "string") return reject(socket, "auth first");
          authenticator.authenticate(msg.token).then(
            (id) => {
              clearTimeout(timer);
              if (socket.readyState !== socket.OPEN) return;
              identity = id;
              hub.add(id.userId, socket);
              openUpstream(id);
            },
            (err: unknown) => {
              if (!(err instanceof AuthError)) req.log.error({ err }, "ws auth failed");
              reject(socket, "invalid token");
            },
          );
          return;
        }
        if (msg.type === "ping") return send({ type: "pong" });
        if (msg.type === "auth") return; // duplicate auth: ignore
        // Everything else is a realtime ClientFrame.
        if (upstreamOpen && upstream) upstream.send(text);
        else if (upstream && pending.length < 50) pending.push(text);
      });

      socket.on("close", () => {
        clearTimeout(timer);
        if (identity) hub.remove(identity.userId, socket);
        upstream?.close(1000, "client closed");
      });
    });
  };
