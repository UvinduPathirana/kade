import { describe, expect, it, vi } from "vitest";
import type { EventContext } from "../platform/kafka/event-handler.js";
import { eventHandlersOf } from "../platform/kafka/event-handler.js";
import { CATALOG_EVENT, CatalogEventsConsumer } from "./catalog-events.consumer.js";
import type { Projection } from "./projection.js";

describe("CatalogEventsConsumer", () => {
  it("handles every catalog event type", () => {
    const consumer = new CatalogEventsConsumer({} as Projection);
    expect(
      eventHandlersOf(consumer)
        .map((h) => h.eventType)
        .sort(),
    ).toEqual(Object.values(CATALOG_EVENT).sort());
  });

  it("writes through the runner's transaction and uses the closure dates", async () => {
    const setHours = vi.fn(async () => undefined);
    const replaceMenu = vi.fn(async () => true);
    const consumer = new CatalogEventsConsumer({ setHours, replaceMenu } as unknown as Projection);
    const tx = {} as EventContext["tx"];
    const when = new Date();
    await consumer.hoursChanged(
      {
        restaurantId: "r",
        hours: [],
        closures: [{ id: "c", date: "2026-10-26", reason: "Poya" }],
        occurredAt: when,
      },
      { tx } as EventContext,
    );
    expect(setHours).toHaveBeenCalledWith(tx, "r", [], ["2026-10-26"], when);
    await consumer.menuUpdated(
      {
        restaurantId: "r",
        menu: { restaurantId: "", sections: [], popular: [], optionGroups: [], version: 2 },
        occurredAt: when,
      },
      { tx } as EventContext,
    );
    expect(replaceMenu).toHaveBeenCalledWith(tx, expect.objectContaining({ restaurantId: "r", version: 2 }));
  });
});
