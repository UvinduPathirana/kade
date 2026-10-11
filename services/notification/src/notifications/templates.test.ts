import { status } from "@grpc/grpc-js";
import { describe, expect, it } from "vitest";
import type { DomainError } from "../platform/grpc/errors.js";
import { firstName, formatRs, formatWhen, render, TEMPLATES } from "./templates.js";

describe("render", () => {
  it("fills the placeholders in the apps' voice", () => {
    expect(render("order_picked_up", { rider: "Nimal", restaurant: "Galle Road Kottu House" }).body).toBe(
      "Nimal is on the way with your order from Galle Road Kottu House.",
    );
  });

  it("drops optional params cleanly", () => {
    expect(render("payment_declined", { amount: "Rs 2,350" }).body).toBe(
      "Your card was declined for Rs 2,350. Try another card or pay cash on delivery.",
    );
    expect(render("payment_declined", { amount: "Rs 2,350", card: " ending 4242" }).body).toContain(
      "Your card ending 4242 was declined",
    );
  });

  it("rejects unknown templates and missing params", () => {
    const unknown = (() => {
      try {
        render("nope", {});
      } catch (e) {
        return e as DomainError;
      }
    })();
    expect(unknown).toMatchObject({ code: status.INVALID_ARGUMENT, reason: "TEMPLATE_UNKNOWN" });
    expect(() => render("otp", {})).toThrow(/code/);
  });

  it("every template renders with all of its params", () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const params = Object.fromEntries([...tpl.text.matchAll(/\{(\w+)\??\}/g)].map((m) => [m[1]!, "x"]));
      expect(render(tpl.id, params).body).not.toMatch(/[{}]/);
    }
  });
});

describe("formatting", () => {
  it("formats money, names and times", () => {
    expect(formatRs(115_000)).toBe("Rs 1,150");
    expect(formatRs(45_050)).toBe("Rs 451");
    expect(firstName("Nimal Fernando")).toBe("Nimal");
    expect(formatWhen(new Date("2026-10-12T14:00:00Z"))).toBe("7:30 pm on Mon 12 Oct");
  });
});
