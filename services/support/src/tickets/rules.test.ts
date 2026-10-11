import { Order } from "@kade/proto/kade/order/v1/order_service";
import { IssueKind, RequesterKind, TicketPriority } from "@kade/proto/kade/support/v1/support_service";
import { describe, expect, it } from "vitest";
import { formatRs, greeting, isBreached, issueAmount, issueMessage, issueSubject, slaDue } from "./rules.js";

const rs = (n: number) => ({ amountMinor: n * 100, currency: "LKR" });
const order = Order.fromPartial({
  id: "o1",
  orderNumber: "KD-4821",
  restaurant: { name: "Galle Road Kottu House", discountPercent: 10 },
  lines: [
    { key: "l1", name: "Cheese kottu", unitPrice: rs(1450), quantity: 2 },
    { key: "l2", name: "Faluda", unitPrice: rs(450), quantity: 1 },
  ],
  totals: { deliveryFee: rs(150), total: rs(3500), credit: rs(200) },
});

describe("issueAmount (customer app issueAmount rules)", () => {
  it("pays back affected dishes after the restaurant discount, capped at what was ordered", () => {
    // (1450 × 2 + 450 × 1) × 0.9 = 3015
    expect(
      issueAmount(order, IssueKind.ISSUE_KIND_MISSING, [
        { lineKey: "l1", quantity: 5 },
        { lineKey: "l2", quantity: 1 },
        { lineKey: "nope", quantity: 1 },
      ]),
    ).toBe(301_500);
  });

  it("covers late, never arrived and charged", () => {
    expect(issueAmount(order, IssueKind.ISSUE_KIND_LATE, [])).toBe(200_00);
    expect(
      issueAmount(
        { ...order, totals: { ...order.totals!, deliveryFee: rs(350) } },
        IssueKind.ISSUE_KIND_LATE,
        [],
      ),
    ).toBe(350_00);
    expect(issueAmount(order, IssueKind.ISSUE_KIND_NEVER_ARRIVED, [])).toBe(3_700_00);
    expect(issueAmount(order, IssueKind.ISSUE_KIND_CHARGED, [])).toBe(0);
  });
});

describe("SLA", () => {
  const opened = new Date("2026-10-12T14:00:00Z");
  it("gives each priority its first-response window", () => {
    expect(slaDue(opened, TicketPriority.TICKET_PRIORITY_URGENT).toISOString()).toBe(
      "2026-10-12T14:15:00.000Z",
    );
    expect(slaDue(opened, TicketPriority.TICKET_PRIORITY_HIGH).toISOString()).toBe(
      "2026-10-12T15:00:00.000Z",
    );
    expect(slaDue(opened, TicketPriority.TICKET_PRIORITY_NORMAL).toISOString()).toBe(
      "2026-10-12T18:00:00.000Z",
    );
    expect(slaDue(opened, TicketPriority.TICKET_PRIORITY_LOW).toISOString()).toBe("2026-10-13T14:00:00.000Z");
  });

  it("counts a late first answer as a breach", () => {
    const due = new Date("2026-10-12T14:15:00Z");
    expect(isBreached({ slaDueAt: due, firstResponseAt: null }, new Date("2026-10-12T14:20:00Z"))).toBe(true);
    expect(isBreached({ slaDueAt: due, firstResponseAt: null }, new Date("2026-10-12T14:10:00Z"))).toBe(
      false,
    );
    expect(isBreached({ slaDueAt: due, firstResponseAt: new Date("2026-10-12T14:16:00Z") }, new Date())).toBe(
      true,
    );
  });
});

describe("copy", () => {
  it("writes subjects and first messages an agent can act on", () => {
    expect(issueSubject(IssueKind.ISSUE_KIND_MISSING, "KD-4821")).toBe("Missing items from KD-4821");
    expect(
      issueMessage(order, IssueKind.ISSUE_KIND_SPILLED, [{ lineKey: "l2", quantity: 3 }], " Lid came off. "),
    ).toBe("Spilled or damaged: 1 × Faluda. Lid came off.");
    expect(greeting(RequesterKind.REQUESTER_KIND_CUSTOMER, "Dilini Perera")).toMatch(
      /^Hi Dilini, I'm Tharushi from Kadé support\./,
    );
    expect(greeting(RequesterKind.REQUESTER_KIND_RIDER, "Nimal")).toMatch(/^Hi Nimal, rider support here/);
    expect(formatRs(1_150_00)).toBe("Rs 1,150");
  });
});
