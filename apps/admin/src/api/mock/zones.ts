// Delivery zones and fees. Later: the pricing service (GET /zones, PATCH /zones/:id, /surcharges).
import type { SurchargeRule, WeatherSurcharge, Zone } from "../types";

const z = (
  id: string,
  code: string,
  name: string,
  baseFee: number,
  perKm: number,
  ridersNeeded: number,
  open = true,
): Zone => ({ id, code, name, open, baseFee, perKm, smallOrderFee: 80, smallOrderUnder: 500, ridersNeeded });

export const zones: Zone[] = [
  z("c15", "Colombo 15", "Mattakkuliya", 150, 40, 1),
  z("c14", "Colombo 14", "Grandpass", 150, 40, 1),
  z("c13", "Colombo 13", "Kotahena", 130, 35, 1),
  z("c01", "Colombo 01", "Fort", 120, 35, 2),
  z("c11", "Colombo 11", "Pettah", 120, 35, 1),
  z("c12", "Colombo 12", "Hulftsdorp", 130, 35, 1),
  z("c10", "Colombo 10", "Maradana", 130, 35, 1),
  z("c09", "Colombo 09", "Dematagoda", 150, 40, 1),
  z("c02", "Colombo 02", "Slave Island", 120, 35, 2),
  z("c08", "Colombo 08", "Borella", 130, 35, 2),
  z("raj", "Rajagiriya", "Rajagiriya", 180, 45, 1),
  z("c03", "Colombo 03", "Kollupitiya", 100, 30, 6),
  z("c07", "Colombo 07", "Cinnamon Gardens", 120, 35, 3),
  z("c04", "Colombo 04", "Bambalapitiya", 100, 30, 4),
  z("c05", "Colombo 05", "Havelock Town", 120, 35, 2),
  z("nug", "Nugegoda", "Nugegoda", 180, 45, 1),
  z("c06", "Colombo 06", "Wellawatte", 110, 30, 4),
  z("deh", "Dehiwala", "Dehiwala", 150, 40, 2),
  z("mtl", "Mount Lavinia", "Mount Lavinia", 180, 45, 1, false),
];

export const surcharges: SurchargeRule[] = [
  {
    id: "s1",
    label: "Lunch peak",
    days: "Mon to Fri",
    start: "12:00",
    end: "14:00",
    amount: 30,
    enabled: true,
  },
  {
    id: "s2",
    label: "Dinner peak",
    days: "Every day",
    start: "19:00",
    end: "21:30",
    amount: 40,
    enabled: true,
  },
  {
    id: "s3",
    label: "Weekend late nights",
    days: "Fri to Sun",
    start: "23:00",
    end: "02:00",
    amount: 60,
    enabled: true,
  },
  {
    id: "s4",
    label: "Poya day",
    days: "Every day",
    start: "10:00",
    end: "22:00",
    amount: 50,
    enabled: false,
  },
];

export const weather: WeatherSurcharge = { enabled: false, amount: 50 };
