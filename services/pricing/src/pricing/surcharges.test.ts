import { describe, expect, it } from "vitest";
import { colombo, fixtureRules } from "./fixtures.test-helpers.js";
import { colomboClock, surchargeActive } from "./surcharges.js";

const [lunch, dinner, lateNight, poya] = fixtureRules().surcharges as [never, never, never, never];

// 2026-10-12 is a Monday.
describe("surchargeActive (Asia/Colombo)", () => {
  it("reads the Colombo wall clock whatever the server timezone", () => {
    expect(colomboClock(new Date("2026-10-12T07:00:00Z"))).toEqual({ weekday: 1, minute: 12 * 60 + 30 });
    expect(colomboClock(new Date("2026-10-11T19:00:00Z"))).toEqual({ weekday: 1, minute: 30 });
  });

  it.each([
    ["lunch peak on a weekday", lunch, "2026-10-12T12:30", true],
    ["lunch peak not on Saturday", lunch, "2026-10-17T12:30", false],
    ["start is inclusive", dinner, "2026-10-12T19:00", true],
    ["end is exclusive", dinner, "2026-10-12T21:30", false],
    ["dinner peak every day", dinner, "2026-10-18T20:00", true],
    ["late night on Friday evening", lateNight, "2026-10-16T23:30", true],
    ["after midnight belongs to Friday's rule (Sat 01:00)", lateNight, "2026-10-17T01:00", true],
    ["Sunday night into Monday 01:00 is still Sunday's rule", lateNight, "2026-10-19T01:00", true],
    ["Monday night into Tuesday 01:00 is not covered", lateNight, "2026-10-13T01:00", false],
    ["Thursday 23:30 is not covered", lateNight, "2026-10-15T23:30", false],
    ["end of the overnight window is exclusive", lateNight, "2026-10-17T02:00", false],
    ["disabled rules never apply", poya, "2026-10-12T12:00", false],
  ])("%s", (_name, rule, at, expected) => {
    expect(surchargeActive(rule, colombo(at))).toBe(expected);
  });
});
