import type { WebSocket } from "ws";

/**
 * In-process registry of open sockets per user. Enough for one gateway replica; cross-replica
 * fan-out (kitchen board, tracking) belongs to the Go `realtime` service over Redis pub/sub.
 */
export class Hub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
  }

  remove(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId);
    set?.delete(socket);
    if (set?.size === 0) this.sockets.delete(userId);
  }

  publish(userId: string, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const socket of this.sockets.get(userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.sockets.values()) for (const socket of set) socket.close(code, reason);
    this.sockets.clear();
  }
}

/** Messages the server sends on /ws (documented in README.md, "WebSocket protocol"). */
export type ServerMessage =
  | { type: "ready"; userId: string; realtime: boolean }
  | { type: "pong" }
  | { type: "error"; code: string; message: string };
