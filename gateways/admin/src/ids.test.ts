import { describe, expect, it } from "vitest";
import {
  auditRecordToConsole,
  auditRecordToService,
  personId,
  personUuid,
  restaurantNumber,
  restaurantUuid,
} from "./ids.js";

describe("id translation", () => {
  it("maps seeded restaurants to the console's numbers and back", () => {
    expect(restaurantNumber("00000000-0000-7000-8000-000000000016")).toBe(16);
    expect(restaurantUuid(1)).toBe("00000000-0000-7000-8000-000000000001");
  });

  it("gives other outlets a stable number it can send back", () => {
    const uuid = "0199d3a0-1234-7abc-9def-0123456789ab";
    const n = restaurantNumber(uuid);
    expect(n).toBeGreaterThan(1e12);
    expect(Number.isSafeInteger(n)).toBe(true);
    expect(restaurantNumber(uuid)).toBe(n);
    expect(restaurantUuid(n)).toBe(uuid);
  });

  it("reads seeded people as R-/C-/U-/S- ids and passes others through", () => {
    expect(personId("00000000-0000-7000-8001-000000000101")).toBe("R-101");
    expect(personId("00000000-0000-7000-8002-000000002040")).toBe("C-2040");
    expect(personId("00000000-0000-7000-8005-000000000005")).toBe("U-5");
    expect(personId("00000000-0000-7000-8006-000000000001")).toBe("S-1");
    expect(personUuid("R-101")).toBe("00000000-0000-7000-8001-000000000101");
    expect(personUuid("0199d3a0-1234-7abc-9def-0123456789ab")).toBe("0199d3a0-1234-7abc-9def-0123456789ab");
  });

  it("stores audit record ids as service ids and shows console ids", () => {
    expect(auditRecordToService("restaurant", "13")).toBe("00000000-0000-7000-8000-000000000013");
    expect(auditRecordToService("customer", "C-2152")).toBe("00000000-0000-7000-8002-000000002152");
    expect(auditRecordToService("order", "KD-4821")).toBe("KD-4821");
    expect(auditRecordToConsole("restaurant", "00000000-0000-7000-8000-000000000013")).toBe("13");
    expect(auditRecordToConsole("rider", "00000000-0000-7000-8001-000000000101")).toBe("R-101");
  });
});
