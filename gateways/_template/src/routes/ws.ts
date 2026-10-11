import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "ws";
import { AuthError, type Authenticator, type Identity } from "../auth.js";
import type { Hub, ServerMessage } from "../hub.js";

const AUTH_TIMEOUT_MS = 5_000;
const CLOSE_UNAUTHORIZED = 4401;

/**
 * GET /ws. Browsers cannot set headers on a WebSocket, and tokens in URLs end up in logs, so the
 * first message must be {"type":"auth","token":"<access token>"}. Then: {"type":"ping"} -> pong,
 * and server pushes such as {"type":"note.created","note":{...}}.
 */
export const wsRoutes =
  ({ authenticator, hub }: { authenticator: Authenticator; hub: Hub }): FastifyPluginAsync =>
  async (app) => {
    app.get("/ws", { websocket: true, schema: { hide: true }, config: { auth: "public" } }, (socket, req) => {
      let identity: Identity | undefined;
      const send = (m: ServerMessage): void => socket.send(JSON.stringify(m));
      const reject = (s: WebSocket, reason: string): void => s.close(CLOSE_UNAUTHORIZED, reason);
      const timer = setTimeout(() => reject(socket, "auth timeout"), AUTH_TIMEOUT_MS);

      socket.on("message", (raw) => {
        let msg: { type?: unknown; token?: unknown };
        try {
          msg = JSON.parse(raw.toString()) as typeof msg;
        } catch {
          return send({ type: "error", code: "BAD_MESSAGE", message: "Messages are JSON objects." });
        }
        if (!identity) {
          if (msg.type !== "auth" || typeof msg.token !== "string") return reject(socket, "auth first");
          authenticator.authenticate(msg.token).then(
            (id) => {
              clearTimeout(timer);
              identity = id;
              hub.add(id.userId, socket);
              send({ type: "ready", userId: id.userId });
            },
            (err: unknown) => {
              if (!(err instanceof AuthError)) req.log.error({ err }, "ws auth failed");
              reject(socket, "invalid token");
            },
          );
          return;
        }
        if (msg.type === "ping") return send({ type: "pong" });
        send({ type: "error", code: "UNKNOWN_TYPE", message: `Unknown message type ${String(msg.type)}` });
      });

      socket.on("close", () => {
        clearTimeout(timer);
        if (identity) hub.remove(identity.userId, socket);
      });
    });
  };
