import { Injectable } from "@nestjs/common";
import { context, propagation } from "@opentelemetry/api";
import { v7 as uuidv7 } from "uuid";
import { outbox } from "../../db/schema.js";
import type { Tx } from "../db/database.js";

export interface OutboxEvent {
  /** Routes to topic kade.<aggregateType>.events (Debezium outbox router). */
  aggregateType: string;
  /** Kafka key: all events of one aggregate land on one partition, in order. */
  aggregateId: string;
  /** Fully-qualified proto message name; consumers decode by it (Kafka header `eventType`). */
  type: string;
  /** Protobuf-encoded event, e.g. NoteCreated.encode(event).finish(). */
  payload: Uint8Array;
}

/**
 * Writes events to the transactional outbox. Takes a Tx on purpose: an event must commit or roll
 * back together with the state change that caused it. Never publish to Kafka from a handler.
 */
@Injectable()
export class OutboxWriter {
  async append(tx: Tx, event: OutboxEvent): Promise<string> {
    const id = uuidv7();
    await tx.insert(outbox).values({
      id,
      aggregatetype: event.aggregateType,
      aggregateid: event.aggregateId,
      type: event.type,
      payload: event.payload,
      // Debezium copies this into the Kafka header so the consumer's span joins this trace.
      traceparent: currentTraceparent(),
    });
    return id;
  }
}

export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}
