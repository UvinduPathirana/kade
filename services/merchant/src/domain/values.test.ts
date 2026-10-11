import { describe, expect, it } from "vitest";
import { DomainError } from "../platform/grpc/errors.js";
import { formatPhone, normalisePhone, outletIdOf, ticketNumberOf, zoneForArea } from "./values.js";

describe("normalisePhone", () => {
  it.each(["+94 77 312 4410", "0773124410", "94773124410", "773124410", "+94-77-312-4410"])(
    "normalises %s",
    (raw) => {
      expect(normalisePhone(raw)).toBe("+94773124410");
    },
  );

  it.each(["", "12345", "+44 20 7946 0958", "077312441"])("rejects %s", (raw) => {
    expect(() => normalisePhone(raw)).toThrow(DomainError);
  });

  it("formats for display", () => {
    expect(formatPhone("+94773124410")).toBe("+94 77 312 4410");
  });
});

describe("ids and lookups", () => {
  it("builds seeded outlet ids (CONVENTIONS)", () => {
    expect(outletIdOf(1)).toBe("00000000-0000-7000-8000-000000000001");
    expect(outletIdOf(16)).toBe("00000000-0000-7000-8000-000000000016");
  });

  it("takes the ticket number from the order number", () => {
    expect(ticketNumberOf("KD-2417", "x")).toBe("2417");
    expect(ticketNumberOf("", "0199d3a0-0000-7000-8000-00000000abcd")).toBe("ABCD");
  });

  it("maps admin-console areas to zone slugs", () => {
    expect(zoneForArea("Kollupitiya")).toBe("c03");
    expect(zoneForArea("Somewhere", "Dehiwala")).toBe("deh");
    expect(zoneForArea("Kandy")).toBe("");
  });
});
