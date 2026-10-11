import { DiscoveryService } from "@nestjs/core";
import type { Tx } from "../db/database.js";

export interface EventContext {
  /** Open transaction. Write side effects through it: they commit together with the dedup row. */
  tx: Tx;
  /** Kafka header `id` (= outbox row id). Already recorded in processed_events. */
  eventId: string;
  eventType: string;
  topic: string;
  partition: number;
  offset: string;
  /** Kafka key = aggregate id. */
  key: string | undefined;
  /** 1-based attempt number (retries re-run the whole transaction). */
  attempt: number;
}

/** ts-proto message codec (only decode is needed here). */
export interface Decoder<T> {
  decode(input: Uint8Array): T;
}

/**
 * Throw from a handler when retrying cannot help (the event is invalid for this service).
 * The message goes to the DLQ immediately instead of after all retry attempts.
 */
export class PermanentEventError extends Error {
  override name = "PermanentEventError";
}

export interface EventConsumerOptions {
  /** Topics this class consumes, e.g. ["kade.note.events"]. */
  topics: string[];
}

export const EventConsumerMeta = DiscoveryService.createDecorator<EventConsumerOptions>();

/** Marks a Nest provider whose @OnEvent methods handle events from the given topics. */
export function EventConsumer(options: EventConsumerOptions): ClassDecorator {
  return (target) => EventConsumerMeta(options)(target);
}

export interface EventHandlerBinding {
  eventType: string;
  decoder: Decoder<unknown>;
  method: string | symbol;
}

const handlers = new WeakMap<object, EventHandlerBinding[]>();

/**
 * Handles one event type (the `eventType` header = fully-qualified proto message name). The
 * decoder's type must match the method's first parameter; this is checked at compile time.
 *
 *   @OnEvent("kade.template.v1.NoteCreated", NoteCreated)
 *   async noteCreated(event: NoteCreated, ctx: EventContext) { ... }
 */
export function OnEvent<T>(eventType: string, decoder: Decoder<T>) {
  return (
    target: object,
    method: string | symbol,
    // Unused at runtime; its type is what makes TS check the method signature against T.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _descriptor: TypedPropertyDescriptor<(event: T, ctx: EventContext) => Promise<void>>,
  ): void => {
    const list = handlers.get(target) ?? [];
    list.push({ eventType, decoder, method });
    handlers.set(target, list);
  };
}

export function eventHandlersOf(instance: object): EventHandlerBinding[] {
  return handlers.get(Object.getPrototypeOf(instance) as object) ?? [];
}
