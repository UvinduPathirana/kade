// Workflow tests: Temporal's time-skipping test server + fakes for every activity. No database,
// no other services: this checks the saga's decisions (order of steps, compensations, timers).
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OrderActivities, PlacedArgs } from "./activities.js";
import {
  cancelSignal,
  collectedSignal,
  deliveredSignal,
  kitchenAcceptedSignal,
  kitchenRejectedSignal,
  pickedUpSignal,
  readySignal,
  stateQuery,
} from "./signals.js";
import {
  ORDER_WORKFLOW,
  type CheckoutPlan,
  type OrderWorkflowInput,
  type OrderWorkflowResult,
  type StepFailure,
  type WorkflowState,
} from "./types.js";

const TASK_QUEUE = "order-test";
const ACCEPT_MS = 180_000;
const CARD = 1;
const CASH = 2;

/** Records every activity call; tests tweak `plan`, `payment` etc. before starting a workflow. */
class Fakes {
  calls: string[] = [];
  plan: CheckoutPlan | StepFailure = card();
  payment: "AUTHORISED" | "CASH_DUE" | "DECLINED" = "AUTHORISED";
  placed: PlacedArgs | undefined;
  /** markX return values (false = transition did not apply). */
  delivery = true;
  prepareFails = false;

  reset(): void {
    this.calls = [];
    this.plan = card();
    this.payment = "AUTHORISED";
    this.placed = undefined;
    this.delivery = true;
    this.prepareFails = false;
  }

  activities(): OrderActivities {
    const rec =
      <R>(name: string, value: (...args: never[]) => R) =>
      async (...args: never[]): Promise<Awaited<R>> => {
        this.calls.push(name);
        return value(...args) as Awaited<R>;
      };
    const acts = {
      prepareCheckout: rec("prepareCheckout", () => {
        if (this.prepareFails) throw new Error("catalog unavailable");
        return this.plan;
      }),
      reservePromo: rec("reservePromo", () => ({ ok: true as const, reservationId: "res-1" })),
      spendCredit: rec("spendCredit", () => ({ ok: true as const })),
      authorisePayment: rec("authorisePayment", () =>
        this.payment === "DECLINED"
          ? { ok: false as const, reason: "PAYMENT_DECLINED", message: "declined" }
          : { ok: true as const, paymentId: "pay-1", status: this.payment },
      ),
      markPlaced: rec("markPlaced", (_id: string, args: PlacedArgs) => {
        this.placed = args;
      }),
      markFailed: rec("markFailed", () => undefined),
      releaseToKitchen: rec("releaseToKitchen", () => undefined),
      markAccepted: rec("markAccepted", () => undefined),
      markRejected: rec("markRejected", () => undefined),
      markCancelled: rec("markCancelled", () => true),
      markReady: rec("markReady", () => true),
      markPickedUp: rec("markPickedUp", () => this.delivery),
      markDelivered: rec("markDelivered", () => this.delivery),
      markCollected: rec("markCollected", () => !this.delivery),
      voidPayment: rec("voidPayment", () => undefined),
      releasePromo: rec("releasePromo", () => undefined),
      reverseCredit: rec("reverseCredit", () => undefined),
      capturePayment: rec("capturePayment", () => undefined),
      recordCashCollection: rec("recordCashCollection", () => undefined),
      refundRemaining: rec("refundRemaining", () => undefined),
    };
    return acts as unknown as OrderActivities;
  }
}

function card(extra: Partial<CheckoutPlan> = {}): CheckoutPlan {
  return {
    ok: true,
    promoCode: "",
    promoDiscountMinor: 0,
    creditMinor: 0,
    totalMinor: 230_000,
    paymentKind: CARD,
    ...extra,
  };
}

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const fakes = new Fakes();
let seq = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./order.workflow.ts", import.meta.url)),
    activities: fakes.activities(),
  });
  running = worker.run();
}, 180_000);

afterAll(async () => {
  worker?.shutdown();
  await running;
  await env?.teardown();
});

beforeEach(() => fakes.reset());

function start(acceptTimeoutMs = ACCEPT_MS) {
  const input: OrderWorkflowInput = { orderId: `order-${++seq}`, acceptTimeoutMs };
  return env.client.workflow.start(ORDER_WORKFLOW, {
    workflowId: input.orderId,
    taskQueue: TASK_QUEUE,
    args: [input],
  });
}

type Handle = Awaited<ReturnType<typeof start>>;

async function untilStage(handle: Handle, stage: WorkflowState["stage"]): Promise<WorkflowState> {
  for (let i = 0; i < 200; i++) {
    const state = await handle.query(stateQuery);
    if (state.stage === stage) return state;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`workflow never reached ${stage}`);
}

const result = (h: Handle) => h.result() as Promise<OrderWorkflowResult>;

describe("order workflow", () => {
  it("happy path, card: authorise → place → accept → ready → pickup (capture) → delivered", async () => {
    fakes.plan = card({ promoCode: "KADE100", promoDiscountMinor: 10_000, creditMinor: 5_000 });
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(kitchenAcceptedSignal, { prepMinutes: 15 });
    await untilStage(h, "in-kitchen");
    await h.signal(readySignal);
    await h.signal(pickedUpSignal, { riderId: "rider-1", deliveryId: "del-1" });
    await h.signal(deliveredSignal, { riderId: "rider-1", deliveryId: "del-1" });
    expect(await result(h)).toEqual({ outcome: "DELIVERED" });
    // Capture runs alongside the delivery steps (it must not hold up DELIVERED), so compare as a set
    // and check it came after the pickup.
    expect(fakes.calls.indexOf("capturePayment")).toBeGreaterThan(fakes.calls.indexOf("markPickedUp"));
    expect([...fakes.calls].sort()).toEqual(
      [
        "prepareCheckout",
        "reservePromo",
        "spendCredit",
        "authorisePayment",
        "markPlaced",
        "markAccepted",
        "markReady",
        "markPickedUp",
        "markDelivered",
        "capturePayment",
      ].sort(),
    );
    expect(fakes.placed).toMatchObject({
      paymentId: "pay-1",
      promoReservationId: "res-1",
      acceptTimeoutMs: ACCEPT_MS,
    });
  });

  it("happy path, cash: CASH_DUE, no capture at pickup, cash recorded at delivery", async () => {
    fakes.plan = card({ paymentKind: CASH });
    fakes.payment = "CASH_DUE";
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(kitchenAcceptedSignal, { prepMinutes: 10 });
    await h.signal(pickedUpSignal, { riderId: "rider-1" });
    await h.signal(deliveredSignal, { riderId: "rider-1", deliveryId: "del-1", cashCollectedMinor: 230_000 });
    expect(await result(h)).toEqual({ outcome: "DELIVERED" });
    expect(fakes.calls).not.toContain("capturePayment");
    expect(fakes.calls.slice(-3)).toEqual(["markPickedUp", "markDelivered", "recordCashCollection"]);
  });

  it("pickup order: collected captures the card", async () => {
    fakes.delivery = false;
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(kitchenAcceptedSignal, { prepMinutes: 10 });
    await h.signal(readySignal);
    await h.signal(collectedSignal, { by: "" });
    expect(await result(h)).toEqual({ outcome: "COLLECTED" });
    expect(fakes.calls.slice(-3)).toEqual(["markReady", "markCollected", "capturePayment"]);
  });

  it("kitchen rejects: REJECTED, then void payment, release promo, reverse credit", async () => {
    fakes.plan = card({ promoCode: "KADE100", creditMinor: 5_000 });
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(kitchenRejectedSignal, { reason: 1, note: "Too busy tonight" });
    expect(await result(h)).toMatchObject({ outcome: "REJECTED" });
    const after = fakes.calls.slice(fakes.calls.indexOf("markRejected"));
    expect(after[0]).toBe("markRejected");
    expect(after.slice(1).sort()).toEqual(["releasePromo", "reverseCredit", "voidPayment"]);
    expect(fakes.calls).not.toContain("markAccepted");
  });

  it("kitchen timeout: the 3-minute timer rejects with TIMEOUT and compensates", async () => {
    const h = await start();
    // Awaiting the result lets the test server skip the 3 minutes.
    expect(await result(h)).toEqual({ outcome: "REJECTED", reason: "TIMEOUT" });
    expect(fakes.calls).toEqual([
      "prepareCheckout",
      "authorisePayment",
      "markPlaced",
      "markRejected",
      "voidPayment",
    ]);
  });

  it("a late accept after the timeout is ignored", async () => {
    const h = await start(1_000);
    expect(await result(h)).toMatchObject({ outcome: "REJECTED" });
    await expect(h.signal(kitchenAcceptedSignal, { prepMinutes: 10 })).rejects.toThrow();
    expect(fakes.calls).not.toContain("markAccepted");
  });

  it("customer cancels before accept: CANCELLED and compensated", async () => {
    fakes.plan = card({ promoCode: "KADE100" });
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(cancelSignal, {
      cancelledBy: 1,
      reason: "Changed my mind",
      fault: 1,
      refund: false,
      by: "Dilini",
    });
    expect(await result(h)).toMatchObject({ outcome: "CANCELLED" });
    const after = fakes.calls.slice(fakes.calls.indexOf("markCancelled"));
    expect(after.slice(1).sort()).toEqual(["releasePromo", "voidPayment"]);
  });

  it("customer cancel after accept is ignored; ops cancel after pickup refunds", async () => {
    const h = await start();
    await untilStage(h, "awaiting-kitchen");
    await h.signal(kitchenAcceptedSignal, { prepMinutes: 10 });
    await untilStage(h, "in-kitchen");
    await h.signal(cancelSignal, {
      cancelledBy: 1,
      reason: "too slow",
      fault: 1,
      refund: false,
      by: "Dilini",
    });
    await h.signal(pickedUpSignal, { riderId: "rider-1" });
    await untilStage(h, "picked-up");
    expect(fakes.calls).not.toContain("markCancelled");
    await h.signal(cancelSignal, { cancelledBy: 2, reason: "Spilled", fault: 3, refund: true, by: "Ops" });
    expect(await result(h)).toMatchObject({ outcome: "CANCELLED" });
    expect(fakes.calls.slice(-2)).toEqual(["markCancelled", "refundRemaining"]);
    expect(fakes.calls).not.toContain("voidPayment");
  });

  it("payment declined: FAILED, promo released, credit reversed, nothing placed", async () => {
    fakes.plan = card({ promoCode: "KADE100", creditMinor: 5_000 });
    fakes.payment = "DECLINED";
    const h = await start();
    expect(await result(h)).toEqual({ outcome: "FAILED", reason: "PAYMENT_DECLINED" });
    expect(fakes.calls).not.toContain("markPlaced");
    expect(fakes.calls).not.toContain("voidPayment");
    const after = fakes.calls.slice(fakes.calls.indexOf("markFailed"));
    expect(after.slice(1).sort()).toEqual(["releasePromo", "reverseCredit"]);
  });

  it("validation failure: FAILED without touching promo or payment", async () => {
    fakes.plan = { ok: false, reason: "ITEM_SOLD_OUT", message: "Cheese kottu is sold out." };
    const h = await start();
    expect(await result(h)).toEqual({ outcome: "FAILED", reason: "ITEM_SOLD_OUT" });
    expect(fakes.calls).toEqual(["prepareCheckout", "markFailed"]);
  });

  it("scheduled order sleeps until the kitchen start, then waits for accept", async () => {
    const releaseAt = new Date((await env.currentTimeMs()) + 2 * 3_600_000).toISOString();
    fakes.plan = card({ releaseAt });
    const h = await start();
    await untilStage(h, "scheduled");
    expect(fakes.placed?.releaseAt).toBe(releaseAt);
    await env.sleep(2 * 3_600_000 + 1_000);
    await untilStage(h, "awaiting-kitchen");
    expect(fakes.calls).toContain("releaseToKitchen");
    await h.signal(cancelSignal, {
      cancelledBy: 1,
      reason: "Plans changed",
      fault: 1,
      refund: false,
      by: "Dilini",
    });
    expect(await result(h)).toMatchObject({ outcome: "CANCELLED" });
  });

  it("scheduled order cancelled while asleep never reaches the kitchen", async () => {
    fakes.plan = card({ releaseAt: new Date((await env.currentTimeMs()) + 86_400_000).toISOString() });
    const h = await start();
    await untilStage(h, "scheduled");
    await h.signal(cancelSignal, {
      cancelledBy: 1,
      reason: "Plans changed",
      fault: 1,
      refund: false,
      by: "Dilini",
    });
    expect(await result(h)).toMatchObject({ outcome: "CANCELLED" });
    expect(fakes.calls).not.toContain("releaseToKitchen");
    expect(fakes.calls).toContain("voidPayment");
  });

  it("checkout outage: retries give up, order FAILED with SERVICE_UNAVAILABLE", async () => {
    fakes.prepareFails = true;
    const h = await start();
    expect(await result(h)).toEqual({ outcome: "FAILED", reason: "SERVICE_UNAVAILABLE" });
    expect(fakes.calls.filter((c) => c === "prepareCheckout")).toHaveLength(4);
    expect(fakes.calls.at(-1)).toBe("markFailed");
  });
});
