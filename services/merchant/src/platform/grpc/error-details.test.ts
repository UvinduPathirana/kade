import { describe, expect, it } from "vitest";
import { decodeErrorInfo, encodeStatus } from "./error-details.js";

describe("google.rpc.Status codec", () => {
  it("round-trips ErrorInfo", () => {
    const info = {
      reason: "PROMO_MIN_SUBTOTAL",
      domain: "promotion",
      metadata: { min: "150000", currency: "LKR" },
    };
    expect(decodeErrorInfo(encodeStatus(9, "Spend a little more", info))).toEqual(info);
  });

  it("returns undefined when there is no ErrorInfo", () => {
    expect(decodeErrorInfo(new Uint8Array([8, 5]))).toBeUndefined();
  });
});
