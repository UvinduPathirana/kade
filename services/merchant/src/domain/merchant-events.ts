import { Inject, Injectable } from "@nestjs/common";
import type { Actor } from "@kade/proto/kade/common/v1/types";
import {
  OutletCommissionChanged,
  OutletStaffInvited,
  OutletStatusChanged,
  PartnerApplicationDecided,
  PartnerApplicationSubmitted,
  TicketAccepted,
  TicketHandedOver,
  TicketReady,
  TicketRejected,
} from "@kade/proto/kade/merchant/v1/merchant_events";
import type { Tx } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { OutboxWriter } from "../platform/outbox/outbox.js";

/** kade.merchant.events: aggregatetype "merchant", key = outlet id (application id before approval). */
export const AGGREGATE = "merchant";

export const EVENT = {
  ticketAccepted: "kade.merchant.v1.TicketAccepted",
  ticketRejected: "kade.merchant.v1.TicketRejected",
  ticketReady: "kade.merchant.v1.TicketReady",
  ticketHandedOver: "kade.merchant.v1.TicketHandedOver",
  outletStatusChanged: "kade.merchant.v1.OutletStatusChanged",
  outletCommissionChanged: "kade.merchant.v1.OutletCommissionChanged",
  applicationSubmitted: "kade.merchant.v1.PartnerApplicationSubmitted",
  applicationDecided: "kade.merchant.v1.PartnerApplicationDecided",
  staffInvited: "kade.merchant.v1.OutletStaffInvited",
} as const;

export function actorOf(ctx: RequestContext | undefined, outletId = ""): Actor {
  if (!ctx) return { userId: "system", roles: [], outletId };
  return { userId: ctx.userId ?? "", roles: [...ctx.roles], outletId: ctx.outletId ?? outletId };
}

/** Typed outbox appends, one per merchant event. Always inside the transaction of the change. */
@Injectable()
export class MerchantEvents {
  constructor(@Inject(OutboxWriter) private readonly outbox: OutboxWriter) {}

  private append(tx: Tx, key: string, type: string, payload: Uint8Array): Promise<string> {
    return this.outbox.append(tx, { aggregateType: AGGREGATE, aggregateId: key, type, payload });
  }

  ticketAccepted(tx: Tx, e: TicketAccepted) {
    return this.append(tx, e.outletId, EVENT.ticketAccepted, TicketAccepted.encode(e).finish());
  }
  ticketRejected(tx: Tx, e: TicketRejected) {
    return this.append(tx, e.outletId, EVENT.ticketRejected, TicketRejected.encode(e).finish());
  }
  ticketReady(tx: Tx, e: TicketReady) {
    return this.append(tx, e.outletId, EVENT.ticketReady, TicketReady.encode(e).finish());
  }
  ticketHandedOver(tx: Tx, e: TicketHandedOver) {
    return this.append(tx, e.outletId, EVENT.ticketHandedOver, TicketHandedOver.encode(e).finish());
  }
  outletStatusChanged(tx: Tx, e: OutletStatusChanged) {
    return this.append(tx, e.outletId, EVENT.outletStatusChanged, OutletStatusChanged.encode(e).finish());
  }
  outletCommissionChanged(tx: Tx, e: OutletCommissionChanged) {
    return this.append(
      tx,
      e.outletId,
      EVENT.outletCommissionChanged,
      OutletCommissionChanged.encode(e).finish(),
    );
  }
  applicationSubmitted(tx: Tx, e: PartnerApplicationSubmitted) {
    return this.append(
      tx,
      e.applicationId,
      EVENT.applicationSubmitted,
      PartnerApplicationSubmitted.encode(e).finish(),
    );
  }
  applicationDecided(tx: Tx, e: PartnerApplicationDecided) {
    // Approved: key by the new outlet (= application id) so it orders with the outlet's later events.
    return this.append(
      tx,
      e.application?.outletId || e.applicationId,
      EVENT.applicationDecided,
      PartnerApplicationDecided.encode(e).finish(),
    );
  }
  staffInvited(tx: Tx, e: OutletStaffInvited) {
    return this.append(tx, e.outletId, EVENT.staffInvited, OutletStaffInvited.encode(e).finish());
  }
}
