import { Inject, Injectable } from "@nestjs/common";
import type { Actor } from "@kade/proto/kade/common/v1/types";
import { MerchantEvents } from "../domain/merchant-events.js";
import type { Tx } from "../platform/db/database.js";
import { notFound } from "../platform/grpc/errors.js";
import { computeAccepting, statusChanged, toOutletStatus } from "./outlet-mapper.js";
import { OutletsRepository, type NewOutlet, type OutletRow } from "./outlets.repository.js";

/**
 * Every change to busy mode, pause, ops status or tablet connectivity goes through here: lock the
 * outlet, apply the change, and publish OutletStatusChanged(previous → status) when anything a consumer
 * cares about changed. The stored `accepting` flag is the last published value.
 */
@Injectable()
export class OutletStatusUpdater {
  constructor(
    @Inject(OutletsRepository) private readonly outlets: OutletsRepository,
    @Inject(MerchantEvents) private readonly events: MerchantEvents,
  ) {}

  async change(
    tx: Tx,
    outletId: string,
    actor: Actor,
    mutate: (row: OutletRow) => Partial<NewOutlet>,
    now = new Date(),
  ): Promise<OutletRow> {
    const before = await this.outlets.lock(tx, outletId);
    if (!before) throw notFound("OUTLET_NOT_FOUND", "We couldn't find that outlet.", { outlet_id: outletId });
    const change = mutate(before);
    const candidate: OutletRow = { ...before, ...change } as OutletRow;
    const accepting = computeAccepting(candidate, now);
    const after = await this.outlets.update(tx, outletId, { ...change, accepting });

    // "previous" uses the last *published* accepting value, so silence detected late still flips it.
    const previous = { ...toOutletStatus(before, now), accepting: before.accepting };
    const status = toOutletStatus(after, now);
    if (statusChanged(previous, status)) {
      await this.events.outletStatusChanged(tx, {
        outletId,
        status,
        previous,
        actor: { ...actor, outletId: actor.outletId || outletId },
        occurredAt: now,
      });
    }
    return after;
  }
}
