import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { idempotencyKeys } from "../../db/schema.js";
import type { Tx } from "../db/database.js";
import { failedPrecondition } from "../grpc/errors.js";

/** The encode/decode half of a ts-proto message (e.g. CreateNoteResponse). */
export interface Codec<T> {
  encode(message: T): { finish(): Uint8Array };
  decode(input: Uint8Array): T;
}

export interface IdempotencyOptions<T> {
  /** Namespace for the key: RPC name + caller, e.g. `CreateNote:${userId}`. */
  scope: string;
  /** The client's idempotency_key. Empty = not idempotent, just run. */
  key: string;
  /** The encoded request, to detect a key reused with a different body. */
  request: Uint8Array;
  /** How to store and replay the response. */
  codec: Codec<T>;
}

/**
 * Exactly-once effect for retried mutating RPCs. Must run inside the same transaction as the
 * mutation: the key row, the business rows and the outbox row commit together, so a retry either
 * sees the stored response or (if the first attempt rolled back) does the work again.
 *
 * Concurrent retries are safe: the second INSERT blocks on the primary key until the first
 * transaction commits, then does nothing and reads the committed response.
 */
@Injectable()
export class IdempotencyStore {
  async run<T>(tx: Tx, opts: IdempotencyOptions<T>, work: () => Promise<T>): Promise<T> {
    if (!opts.key) return work();
    const requestHash = createHash("sha256").update(opts.request).digest("base64url");

    const claimed = await tx
      .insert(idempotencyKeys)
      .values({ scope: opts.scope, key: opts.key, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length === 0) {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, opts.scope), eq(idempotencyKeys.key, opts.key)));
      if (!existing?.response) {
        // Only possible if the row was written outside run(); treat as a conflicting reuse.
        throw failedPrecondition("IDEMPOTENCY_KEY_REUSED", "This idempotency key is already in use.");
      }
      if (existing.requestHash !== requestHash) {
        throw failedPrecondition(
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used for a different request.",
        );
      }
      return opts.codec.decode(existing.response);
    }

    const result = await work();
    await tx
      .update(idempotencyKeys)
      .set({ response: opts.codec.encode(result).finish() })
      .where(and(eq(idempotencyKeys.scope, opts.scope), eq(idempotencyKeys.key, opts.key)));
    return result;
  }
}
