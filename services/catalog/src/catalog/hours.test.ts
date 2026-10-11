import { AvailabilityState } from "@kade/proto/kade/catalog/v1/catalog_service";
import { describe, expect, it } from "vitest";
import type { HoursDay } from "../db/schema.js";
import {
  colomboParts,
  computeAvailability,
  formatClock,
  hoursLabel,
  isOpenAt,
  makeClock,
  nextOpening,
  parseHoursLabel,
  validateWeek,
} from "./hours.js";

/** An instant from a Colombo wall-clock time. */
const at = (local: string): Date => new Date(`${local}+05:30`);
const week = (open: string, close: string): HoursDay[] =>
  [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, isOpen: true, ranges: [{ open, close }] }));
const none = new Set<string>();
const base = { closedDates: none, adminStatus: "open", pausedUntil: null, busyExtraMinutes: 0 };

describe("clock helpers", () => {
  it("reads Colombo local time regardless of the host zone", () => {
    // 2026-10-12 is a Monday.
    expect(colomboParts(at("2026-10-12T01:15:00"))).toEqual({ date: "2026-10-12", weekday: 1, minutes: 75 });
    expect(colomboParts(at("2026-10-18T23:59:00")).weekday).toBe(7);
  });

  it.each([
    [0, "12 am"],
    [8 * 60, "8 am"],
    [12 * 60, "12 pm"],
    [19 * 60 + 30, "7:30 pm"],
    [24 * 60 + 120, "2 am"],
  ])("formats %i minutes as %s", (m, label) => expect(formatClock(m)).toBe(label));

  it("parses the mock's hours labels", () => {
    expect(parseHoursLabel("11 am – 2 am")).toEqual({ open: "11:00", close: "02:00" });
    expect(parseHoursLabel("12 pm – 12 am")).toEqual({ open: "12:00", close: "00:00" });
    expect(parseHoursLabel("7 am – 9 pm")).toEqual({ open: "07:00", close: "21:00" });
  });

  it("pins the time of day with DEMO_TIME", () => {
    expect(colomboParts(makeClock("19:00")()).minutes).toBe(19 * 60);
    expect(Math.abs(makeClock(undefined)().getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe("opening hours", () => {
  const lateNight = week("11:00", "02:00");

  it("is open across midnight on yesterday's range", () => {
    expect(isOpenAt(lateNight, none, at("2026-10-12T01:30:00"))).toBe(true);
    expect(isOpenAt(lateNight, none, at("2026-10-12T02:00:00"))).toBe(false);
    expect(isOpenAt(lateNight, none, at("2026-10-12T10:59:00"))).toBe(false);
    expect(isOpenAt(lateNight, none, at("2026-10-12T11:00:00"))).toBe(true);
  });

  it("skips closure days (a closure day's late-night range is closed too)", () => {
    const poya = new Set(["2026-10-26"]);
    expect(isOpenAt(lateNight, poya, at("2026-10-26T13:00:00"))).toBe(false);
    expect(isOpenAt(lateNight, poya, at("2026-10-27T01:00:00"))).toBe(false);
    expect(nextOpening(lateNight, poya, at("2026-10-26T09:00:00"))).toEqual(at("2026-10-27T11:00:00"));
  });

  it("labels today's hours, including split days", () => {
    const split: HoursDay[] = week("11:00", "02:00").map((d) =>
      d.day === 7
        ? {
            ...d,
            ranges: [
              { open: "11:00", close: "15:00" },
              { open: "18:00", close: "02:00" },
            ],
          }
        : d,
    );
    expect(hoursLabel(split, none, at("2026-10-18T12:00:00"))).toBe("11 am – 3 pm, 6 pm – 2 am");
    expect(hoursLabel(split, new Set(["2026-10-18"]), at("2026-10-18T12:00:00"))).toBe("Closed today");
  });
});

describe("computeAvailability", () => {
  const donut = week("08:00", "20:00");

  it("is open inside the hours", () => {
    expect(computeAvailability({ ...base, hours: donut }, at("2026-10-12T09:00:00")).state).toBe(
      AvailabilityState.AVAILABILITY_STATE_OPEN,
    );
  });

  it("says when it opens next, as the app shows it", () => {
    expect(computeAvailability({ ...base, hours: donut }, at("2026-10-12T06:00:00"))).toMatchObject({
      state: AvailabilityState.AVAILABILITY_STATE_CLOSED,
      closedLabel: "Opens at 8 am",
      opensAt: at("2026-10-12T08:00:00"),
    });
    expect(computeAvailability({ ...base, hours: donut }, at("2026-10-12T21:00:00")).closedLabel).toBe(
      "Opens tomorrow at 8 am",
    );
    const weekdaysOnly = donut.map((d) => (d.day >= 6 ? { ...d, isOpen: false, ranges: [] } : d));
    expect(computeAvailability({ ...base, hours: weekdaysOnly }, at("2026-10-17T10:00:00")).closedLabel).toBe(
      "Opens Mon at 8 am",
    );
  });

  it("puts suspension and pause ahead of the hours", () => {
    const now = at("2026-10-12T09:00:00");
    expect(computeAvailability({ ...base, hours: donut, adminStatus: "suspended" }, now).state).toBe(
      AvailabilityState.AVAILABILITY_STATE_SUSPENDED,
    );
    expect(
      computeAvailability(
        { ...base, hours: donut, pausedUntil: at("2026-10-12T19:30:00"), busyExtraMinutes: 10 },
        now,
      ),
    ).toMatchObject({
      state: AvailabilityState.AVAILABILITY_STATE_PAUSED,
      closedLabel: "Back at 7:30 pm",
      busyExtraMinutes: 10,
    });
    // An expired pause is ignored.
    expect(
      computeAvailability({ ...base, hours: donut, pausedUntil: at("2026-10-12T08:00:00") }, now).state,
    ).toBe(AvailabilityState.AVAILABILITY_STATE_OPEN);
  });
});

describe("validateWeek", () => {
  const day = (d: number, isOpen = true) => ({
    day: d,
    isOpen,
    ranges: isOpen ? [{ open: "11:00", close: "02:00" }] : [],
  });

  it("accepts seven days and sorts them", () => {
    const result = validateWeek([7, 6, 5, 4, 3, 2, 1].map((d) => day(d, d !== 1)));
    expect(result.ok && result.week.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it.each([
    [[1, 2, 3].map((d) => day(d)), "all seven days"],
    [[1, 1, 2, 3, 4, 5, 6].map((d) => day(d)), "only appear once"],
    [[1, 2, 3, 4, 5, 6, 7].map((d) => ({ ...day(d), ranges: [{ open: "25:00", close: "02:00" }] })), "11:00"],
    [[1, 2, 3, 4, 5, 6, 7].map((d) => ({ ...day(d), ranges: [] })), "opening times"],
  ])("rejects %#", (days, message) => {
    const result = validateWeek(days);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(message);
  });
});
