import { Inject, Injectable } from "@nestjs/common";
import {
  Channel,
  NotificationStatus,
  RecipientKind,
  type Notification,
  type Recipient,
} from "@kade/proto/kade/notification/v1/notification_service";
import { v7 as uuidv7 } from "uuid";
import type { Queryable, Tx } from "../platform/db/database.js";
import { DevSink } from "./dev-sink.js";
import {
  NotificationsRepository,
  type NotificationRow,
  type OrderContactRow,
} from "./notifications.repository.js";
import { render } from "./templates.js";

export interface SendInput {
  channel: Channel;
  recipient: Recipient;
  template: string;
  params: Record<string, string>;
  referenceId?: string;
  sendAt?: Date;
  idempotencyKey?: string;
}

/**
 * Renders, stores and "sends" one message. Runs inside the caller's transaction (the gRPC handler's
 * or the consumer's), so the row commits with the idempotency key / processed_events entry.
 *
 * Channel routing: PUSH needs a registered device; without one it falls back to SMS when we have a
 * phone number, otherwise the message is stored as SUPPRESSED with the reason, so support can see
 * we tried. Future send_at → QUEUED, picked up by the Dispatcher.
 */
@Injectable()
export class Notifier {
  constructor(
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(DevSink) private readonly sink: DevSink,
  ) {}

  async send(tx: Tx, input: SendInput, now = new Date()): Promise<NotificationRow> {
    const { body, template } = render(input.template, input.params);
    const recipient = input.recipient;
    const devices = recipient.userId ? await this.repo.devices(tx, recipient.userId) : [];

    let channel = input.channel === Channel.CHANNEL_UNSPECIFIED ? template.channel : input.channel;
    let status = NotificationStatus.NOTIFICATION_STATUS_QUEUED;
    let error: string | null = null;
    if (channel === Channel.CHANNEL_PUSH && devices.length === 0) {
      if (recipient.phone) channel = Channel.CHANNEL_SMS;
      else {
        status = NotificationStatus.NOTIFICATION_STATUS_SUPPRESSED;
        error = "No push device registered and no phone number on file.";
      }
    }
    if (channel === Channel.CHANNEL_SMS && !recipient.phone) {
      status = NotificationStatus.NOTIFICATION_STATUS_SUPPRESSED;
      error = "No phone number on file.";
    }
    if (channel === Channel.CHANNEL_EMAIL && !recipient.email) {
      status = NotificationStatus.NOTIFICATION_STATUS_SUPPRESSED;
      error = "No email address on file.";
    }

    const id = uuidv7();
    const { row, created } = await this.repo.insertOnce(tx, {
      id,
      channel,
      recipientKind: recipient.kind,
      userId: recipient.userId || null,
      phone: recipient.phone || null,
      email: recipient.email || null,
      name: recipient.name || null,
      template: template.id,
      params: input.params,
      body,
      status,
      error,
      attempts: 0,
      referenceId: input.referenceId || null,
      idempotencyKey: input.idempotencyKey || id,
      sendAt: input.sendAt ?? null,
      createdAt: now,
    });
    if (!created) return row;
    if (status === NotificationStatus.NOTIFICATION_STATUS_SUPPRESSED) return row;
    if (input.sendAt && input.sendAt.getTime() > now.getTime()) return row;
    return this.deliver(tx, row, now);
  }

  /**
   * Tells an order's customer something, once per event: the idempotency key is the event id plus
   * the template. Skips silently when we never learnt who the customer is.
   */
  async toOrderCustomer(
    tx: Tx,
    eventId: string,
    contact: OrderContactRow,
    template: string,
    extra: Record<string, string> = {},
  ): Promise<NotificationRow | undefined> {
    if (!contact.customerId) return undefined;
    return this.send(tx, {
      channel: Channel.CHANNEL_UNSPECIFIED,
      recipient: {
        kind: RecipientKind.RECIPIENT_KIND_CUSTOMER,
        userId: contact.customerId,
        phone: contact.customerPhone,
        email: "",
        name: contact.customerName,
      },
      template,
      params: {
        orderNumber: contact.orderNumber || "your order",
        restaurant: contact.restaurantName || "the restaurant",
        ...extra,
      },
      referenceId: contact.orderId,
      idempotencyKey: `evt:${eventId}:${template}`,
    });
  }

  /** Hands a QUEUED row to the sink and records the outcome. */
  async deliver(db: Queryable, row: NotificationRow, now = new Date()): Promise<NotificationRow> {
    const devices =
      row.channel === Channel.CHANNEL_PUSH && row.userId ? await this.repo.devices(db, row.userId) : [];
    try {
      const { providerReference } = await this.sink.deliver({
        id: row.id,
        channel: row.channel,
        to: { userId: row.userId, phone: row.phone, email: row.email, name: row.name },
        body: row.body,
        devices,
      });
      return this.repo.update(db, row.id, {
        status: NotificationStatus.NOTIFICATION_STATUS_SENT,
        providerReference,
        attempts: row.attempts + 1,
        sentAt: now,
        error: null,
      });
    } catch (err) {
      return this.repo.update(db, row.id, {
        status: NotificationStatus.NOTIFICATION_STATUS_FAILED,
        attempts: row.attempts + 1,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function toProto(row: NotificationRow): Notification {
  return {
    id: row.id,
    channel: row.channel,
    recipient: {
      kind: row.recipientKind as RecipientKind,
      userId: row.userId ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      name: row.name ?? "",
    },
    template: row.template,
    params: row.params,
    body: row.body,
    status: row.status,
    providerReference: row.providerReference ?? "",
    error: row.error ?? "",
    attempts: row.attempts,
    createdAt: row.createdAt,
    sentAt: row.sentAt ?? undefined,
    referenceId: row.referenceId ?? "",
  };
}
