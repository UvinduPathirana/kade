import { Inject, Injectable } from "@nestjs/common";
import { OutletStaffInvited } from "@kade/proto/kade/merchant/v1/merchant_events";
import { Channel, RecipientKind } from "@kade/proto/kade/notification/v1/notification_service";
import { PaymentDeclined, PaymentRefundFailed } from "@kade/proto/kade/payment/v1/payment_events";
import { PaymentPurpose } from "@kade/proto/kade/payment/v1/payment_service";
import { TicketMessageAdded, TicketResolved } from "@kade/proto/kade/support/v1/support_events";
import {
  MessageAuthorKind,
  RequesterKind,
  type Requester,
} from "@kade/proto/kade/support/v1/support_service";
import { EventConsumer, OnEvent, type EventContext } from "../../platform/kafka/event-handler.js";
import { NotificationsRepository } from "../notifications.repository.js";
import { Notifier } from "../notifier.js";
import { formatRs } from "../templates.js";

/** Card declines and failed card refunds (order refunds themselves are announced from OrderRefunded). */
@EventConsumer({ topics: ["kade.payment.events"] })
@Injectable()
export class PaymentEventsConsumer {
  constructor(
    @Inject(NotificationsRepository) private readonly repo: NotificationsRepository,
    @Inject(Notifier) private readonly notifier: Notifier,
  ) {}

  @OnEvent("kade.payment.v1.PaymentDeclined", PaymentDeclined)
  async paymentDeclined(event: PaymentDeclined, ctx: EventContext): Promise<void> {
    if (!event.customerId) return;
    const contact =
      event.purpose === PaymentPurpose.PAYMENT_PURPOSE_ORDER
        ? await this.repo.contact(ctx.tx, event.referenceId)
        : undefined;
    await this.notifier.send(ctx.tx, {
      channel: Channel.CHANNEL_UNSPECIFIED,
      recipient: {
        kind: RecipientKind.RECIPIENT_KIND_CUSTOMER,
        userId: event.customerId,
        phone: contact?.customerPhone ?? "",
        email: "",
        name: contact?.customerName ?? "",
      },
      template: "payment_declined",
      params: {
        amount: formatRs(event.amount?.amountMinor ?? 0),
        card: event.cardLast4 ? ` ending ${event.cardLast4}` : "",
      },
      referenceId: event.referenceId,
      idempotencyKey: `evt:${ctx.eventId}:payment_declined`,
    });
  }

  @OnEvent("kade.payment.v1.PaymentRefundFailed", PaymentRefundFailed)
  async refundFailed(event: PaymentRefundFailed, ctx: EventContext): Promise<void> {
    const contact = await this.repo.contact(ctx.tx, event.referenceId);
    if (!contact) return;
    await this.notifier.toOrderCustomer(ctx.tx, ctx.eventId, contact, "payment_refund_failed", {
      amount: formatRs(event.refund?.amount?.amountMinor ?? 0),
    });
  }
}

/** Agent replies and resolutions reach the requester even when the app is closed. */
@EventConsumer({ topics: ["kade.ticket.events"] })
@Injectable()
export class TicketEventsConsumer {
  constructor(@Inject(Notifier) private readonly notifier: Notifier) {}

  @OnEvent("kade.support.v1.TicketMessageAdded", TicketMessageAdded)
  async messageAdded(event: TicketMessageAdded, ctx: EventContext): Promise<void> {
    if (event.message?.from !== MessageAuthorKind.MESSAGE_AUTHOR_KIND_AGENT || !event.requester?.id) return;
    await this.notifier.send(ctx.tx, {
      channel: Channel.CHANNEL_PUSH,
      recipient: recipientOf(event.requester),
      template: "ticket_reply",
      params: { agent: event.message.author || "Kadé support", text: clip(event.message.body, 140) },
      referenceId: event.ticketId,
      idempotencyKey: `evt:${ctx.eventId}:ticket_reply`,
    });
  }

  @OnEvent("kade.support.v1.TicketResolved", TicketResolved)
  async resolved(event: TicketResolved, ctx: EventContext): Promise<void> {
    if (!event.requester?.id) return;
    await this.notifier.send(ctx.tx, {
      channel: Channel.CHANNEL_PUSH,
      recipient: recipientOf(event.requester),
      template: "ticket_resolved",
      params: { summary: event.resolution?.summary ? sentence(event.resolution.summary) : "" },
      referenceId: event.ticketId,
      idempotencyKey: `evt:${ctx.eventId}:ticket_resolved`,
    });
  }
}

/** Staff invites go out by SMS to the invited number. */
@EventConsumer({ topics: ["kade.merchant.events"] })
@Injectable()
export class MerchantEventsConsumer {
  constructor(@Inject(Notifier) private readonly notifier: Notifier) {}

  @OnEvent("kade.merchant.v1.OutletStaffInvited", OutletStaffInvited)
  async staffInvited(event: OutletStaffInvited, ctx: EventContext): Promise<void> {
    if (!event.member?.phone) return;
    await this.notifier.send(ctx.tx, {
      channel: Channel.CHANNEL_SMS,
      recipient: {
        kind: RecipientKind.RECIPIENT_KIND_MERCHANT_STAFF,
        userId: "",
        phone: event.member.phone,
        email: "",
        name: event.member.name,
      },
      template: "staff_invite",
      params: { inviter: "Your manager", outlet: event.outletName || "your restaurant" },
      referenceId: event.outletId,
      idempotencyKey: `evt:${ctx.eventId}:staff_invite`,
    });
  }
}

function recipientOf(requester: Requester) {
  const kind =
    requester.kind === RequesterKind.REQUESTER_KIND_RIDER
      ? RecipientKind.RECIPIENT_KIND_RIDER
      : requester.kind === RequesterKind.REQUESTER_KIND_RESTAURANT
        ? RecipientKind.RECIPIENT_KIND_MERCHANT_STAFF
        : RecipientKind.RECIPIENT_KIND_CUSTOMER;
  return { kind, userId: requester.id, phone: "", email: "", name: requester.name };
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
