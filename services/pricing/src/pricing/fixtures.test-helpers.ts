import type { RuleSet, ZoneRule } from "./rules.js";

// Rules matching the seed migration (subset of zones), for unit tests.
const zone = (
  id: string,
  code: string,
  name: string,
  baseRs: number,
  perKmRs: number,
  lat: number,
  lng: number,
  open = true,
): ZoneRule => ({
  id,
  code,
  name,
  open,
  baseFee: baseRs * 100,
  perKm: perKmRs * 100,
  smallOrderFee: 60_00,
  smallOrderUnder: 500_00,
  ridersNeeded: 1,
  center: { lat, lng },
  radiusKm: 3,
  position: 0,
});

export const KOLLUPITIYA = { lat: 6.91, lng: 79.851 };
export const BAMBALAPITIYA = { lat: 6.893, lng: 79.856 };
export const MOUNT_LAVINIA = { lat: 6.833, lng: 79.865 };
export const KANDY = { lat: 7.2906, lng: 80.6337 };

export function fixtureRules(overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    zones: [
      zone("c03", "Colombo 03", "Kollupitiya", 100, 30, KOLLUPITIYA.lat, KOLLUPITIYA.lng),
      zone("c04", "Colombo 04", "Bambalapitiya", 100, 30, BAMBALAPITIYA.lat, BAMBALAPITIYA.lng),
      zone("deh", "Dehiwala", "Dehiwala", 150, 40, 6.851, 79.865),
      zone("mtl", "Mount Lavinia", "Mount Lavinia", 180, 45, MOUNT_LAVINIA.lat, MOUNT_LAVINIA.lng, false),
    ],
    surcharges: [
      {
        id: "s1",
        label: "Lunch peak",
        days: "mon_to_fri",
        start: "12:00",
        end: "14:00",
        amount: 30_00,
        enabled: true,
      },
      {
        id: "s2",
        label: "Dinner peak",
        days: "every_day",
        start: "19:00",
        end: "21:30",
        amount: 40_00,
        enabled: true,
      },
      {
        id: "s3",
        label: "Weekend late nights",
        days: "fri_to_sun",
        start: "23:00",
        end: "02:00",
        amount: 60_00,
        enabled: true,
      },
      {
        id: "s4",
        label: "Poya day",
        days: "every_day",
        start: "10:00",
        end: "22:00",
        amount: 50_00,
        enabled: false,
      },
    ],
    weather: { enabled: false, amount: 50_00 },
    plusFreeDeliveryFrom: 1_500_00,
    rulesVersion: 7,
    ...overrides,
  };
}

/** A Colombo wall-clock time (UTC+05:30) as an instant. */
export const colombo = (iso: string): Date => new Date(`${iso}+05:30`);
