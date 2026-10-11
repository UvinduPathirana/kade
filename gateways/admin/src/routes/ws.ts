import type { FastifyPluginAsync } from "fastify";
import type { WebSocket as WsSocket } from "ws";
import { AuthError, type Authenticator, type Identity } from "../auth.js";
import type { Hub, ServerMessage } from "../hub.js";
import { isStaffRole } from "../permissions.js";

const AUTH_TIMEOUT_MS = 5_000;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_UPSTREAM_GONE = 1013; // try again later

/**
 * GET /ws. Browsers cannot set headers on a WebSocket, and tokens in URLs end up in logs, so the
 * first message must be {"type":"auth","token":"<access token>"}; only staff may connect. Then
 * {"type":"ping"} -> pong. When REALTIME_WS_URL is set, every other frame is relayed to the realtime
 * service (Go, :8112/ws) with x-user-id / x-roles headers, and realtime's frames (proto3 JSON
 * ServerFrame, e.g. the ops:live channel) are relayed back. Without it, only this replica's hub pushes.
 */
export const wsRoutes =
  ({
    authenticator,
    hub,
    realtimeUrl,
  }: {
    authenticator: Authenticator;
    hub: Hub;
    realtimeUrl?: string;
  }): FastifyPluginAsync =>
  async (app) => {
    app.get("/ws", { websocket: true, schema: { hide: true }, config: { auth: "public" } }, (socket, req) => {
      let identity: Identity | undefined;
      let upstream: globalThis.WebSocket | undefined;
      const pending: string[] = [];
      const send = (m: ServerMessage): void => socket.send(JSON.stringify(m));
      const reject = (s: WsSocket, code: number, reason: string): void => s.close(code, reason);
      const timer = setTimeout(() => reject(socket, CLOSE_UNAUTHORIZED, "auth timeout"), AUTH_TIMEOUT_MS);

      const connectUpstream = (id: Identity) => {
        if (!realtimeUrl) return;
        const up = new globalThis.WebSocket(realtimeUrl, {
          headers: { "x-user-id": id.userId, "x-roles": id.roles.join(",") },
        });
        upstream = up;
        up.addEventListener("open", () => {
          for (const m of pending.splice(0)) up.send(m);
        });
        up.addEventListener("message", (e) => {
          if (socket.readyState === socket.OPEN)
            socket.send(typeof e.data === "string" ? e.data : String(e.data));
        });
        up.addEventListener("close", () => {
          if (socket.readyState === socket.OPEN) socket.close(CLOSE_UPSTREAM_GONE, "realtime unavailable");
        });
        up.addEventListener("error", () => req.log.warn("realtime websocket error"));
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
          if (msg.type !== "auth" || typeof msg.token !== "string")
            return reject(socket, CLOSE_UNAUTHORIZED, "auth first");
          authenticator.authenticate(msg.token).then(
            (id) => {
              clearTimeout(timer);
              if (!id.roles.some(isStaffRole)) return reject(socket, CLOSE_FORBIDDEN, "staff only");
              identity = id;
              hub.add(id.userId, socket);
              connectUpstream(id);
              send({ type: "ready", userId: id.userId });
            },
            (err: unknown) => {
              if (!(err instanceof AuthError)) req.log.error({ err }, "ws auth failed");
              reject(socket, CLOSE_UNAUTHORIZED, "invalid token");
            },
          );
          return;
        }
        if (msg.type === "ping") return send({ type: "pong" });
        if (upstream) {
          if (upstream.readyState === upstream.OPEN) upstream.send(text);
          else if (pending.length < 50) pending.push(text);
          return;
        }
        send({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown message type ${String(msg.type)}` });
      });

      socket.on("close", () => {
        clearTimeout(timer);
        upstream?.close();
        if (identity) hub.remove(identity.userId, socket);
      });
    });
  };
