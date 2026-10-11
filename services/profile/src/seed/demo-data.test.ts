import { FraudFlagStatus } from "@kade/proto/kade/profile/v1/profile_service";
import { describe, expect, it } from "vitest";
import {
  DEMO_CUSTOMERS,
  demoProfileByEmail,
  keycloakUserId,
  seedCustomerId,
  seedCustomers,
} from "./demo-data.js";

describe("demo data", () => {
  it("uses the conventions' seeded ids", () => {
    expect(keycloakUserId(1)).toBe("00000000-0000-7000-8005-000000000001");
    expect(seedCustomerId(2040)).toBe("00000000-0000-7000-8002-000000002040");
    expect(DEMO_CUSTOMERS[0]).toMatchObject({ id: keycloakUserId(1), email: "dilini@kade.test" });
  });

  it("matches Dilini's app mock: two saved addresses and Rs 500 referral credit", () => {
    const dilini = demoProfileByEmail("Dilini@kade.test ")!;
    expect(dilini.addresses.map((a) => a.line)).toEqual([
      "42 Galle Rd, Colombo 03",
      "18 Bauddhaloka Mawatha, Colombo 07",
    ]);
    expect(dilini.credit).toEqual([expect.objectContaining({ amountMinor: 50_000 })]);
  });

  it("is deterministic, with the admin console's flags and one blocked customer", () => {
    const a = seedCustomers();
    const b = seedCustomers();
    expect(a).toEqual(b);
    expect(a).toHaveLength(36);
    expect(a[0]!.id).toBe(seedCustomerId(2040));
    expect(new Set(a.map((c) => c.id)).size).toBe(36);
    expect(a.every((c) => /^\+947\d{8}$/.test(c.phone))).toBe(true);
    expect(a.filter((c) => c.blocked).map((c) => c.name)).toEqual(["Ameer Hamza"]);
    expect(
      a.flatMap((c) => c.flags).filter((f) => f.status === FraudFlagStatus.FRAUD_FLAG_STATUS_OPEN),
    ).toHaveLength(3);
  });
});
