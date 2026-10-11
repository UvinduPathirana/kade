import type { FastifyPluginAsync } from "fastify";
import type { WebSocket as ClientSocket } from "ws";
import { AuthError, type Authenticator, type Identity } from "../auth.js";
import type { Hub, ServerMessage } from "../hub.js";

const AUTH_TIMEOUT_MS = 5_000;
const CLOSE_UNAUTHORIZED = 4401;
const UPSTREAM_CONNECT_MS = 3_000;

export interface WsDeps {
  authenticator: Authenticator;
  hub: Hub;
  /** ws://realtime:8112/ws; empty disables the proxy (the app keeps polling). */
  realtimeUrl: string;
  /** Fills in what realtime needs to authorise: outlet id (merchant) or rider id (rider). */
  enrich: (identity: Identity) => Promise<Identity>;
  /** Channels to subscribe to on the caller's behalf once realtime answers. */
  channels: (identity: Identity) => string[];
}

/**
 * GET /ws. Browsers cannot set headers on a WebSocket, and tokens in URLs end up in logs, so the
 * first message must be {"type":"auth","token":"<access token>"}. The gateway validates it, then
 * reverse-proxies to the realtime service with x-user-id / x-roles / x-outlet-id headers and
 * subscribes the caller's own channels. Frames from realtime (proto3 JSON ServerFrame) are passed
 * through as-is; frames from the app are forwarded (ClientFrame JSON).
 *
 * Realtime down or not built yet: the socket still answers {"type":"ready","realtime":false} and
 * ping/pong, so the app falls back to polling without reconnect storms.
 */
export const wsRoutes =
  ({ authenticator, hub, realtimeUrl, enrich, channels }: WsDeps): FastifyPluginAsync =>
  async (app) => {
    app.get("/ws", { websocket: true, schema: { hide: true }, config: { auth: "public" } }, (socket, req) => {
      let identity: Identity | undefined;
      let upstream: WebSocket | undefined;
      const send = (m: ServerMessage): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      };
      const reject = (s: ClientSocket, reason: string): void => s.close(CLOSE_UNAUTHORIZED, reason);
      const timer = setTimeout(() => reject(socket, "auth timeout"), AUTH_TIMEOUT_MS);

      const connectUpstream = (id: Identity): void => {
        if (!realtimeUrl) return send({ type: "ready", userId: id.userId, realtime: false });
        const headers: Record<string, string> = { "x-user-id": id.userId, "x-roles": id.roles.join(",") };
        if (id.outletId) headers["x-outlet-id"] = id.outletId;
        if (id.riderId) headers["x-rider-id"] = id.riderId;
        let opened = false;
        const ws = new WebSocket(realtimeUrl, { headers });
        upstream = ws;
        const giveUp = setTimeout(() => ws.close(), UPSTREAM_CONNECT_MS);
        ws.addEventListener("open", () => {
          opened = true;
          clearTimeout(giveUp);
          ws.send(JSON.stringify({ subscribe: { channels: channels(id) } }));
          send({ type: "ready", userId: id.userId, realtime: true });
        });
        ws.addEventListener("message", (ev) => {
          if (socket.readyState === socket.OPEN) socket.send(String(ev.data));
        });
        ws.addEventListener("close", () => {
          clearTimeout(giveUp);
          upstream = undefined;
          if (!opened) {
            req.log.debug("realtime unavailable; client keeps polling");
            send({ type: "ready", userId: id.userId, realtime: false });
          } else if (socket.readyState === socket.OPEN) {
            // Let the app reconnect (and refetch over REST) rather than sit on a dead stream.
            socket.close(1012, "realtime restarted");
          }
        });
        ws.addEventListener("error", () => undefined); // "close" follows
      };

      socket.on("message", (raw) => {
        let msg: { type?: unknown; token?: unknown };
        try {
          msg = JSON.parse(raw.toString()) as typeof msg;
        } catch {
          return send({ type: "error", code: "BAD_MESSAGE", message: "Messages are JSON objects." });
        }
        if (!identity) {
          if (msg.type !== "auth" || typeof msg.token !== "string") return reject(socket, "auth first");
          authenticator
            .authenticate(msg.token)
            .then(enrich)
            .then(
              (id) => {
                clearTimeout(timer);
                identity = id;
                hub.add(id.userId, socket);
                connectUpstream(id);
              },
              (err: unknown) => {
                if (!(err instanceof AuthError)) req.log.warn({ err }, "ws auth failed");
                reject(socket, "invalid token");
              },
            );
          return;
        }
        if (msg.type === "ping") return send({ type: "pong" });
        if (upstream?.readyState === WebSocket.OPEN) return upstream.send(raw.toString());
        send({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown message type ${String(msg.type)}` });
      });

      socket.on("close", () => {
        clearTimeout(timer);
        upstream?.close();
        if (identity) hub.remove(identity.userId, socket);
      });
    });
  };
