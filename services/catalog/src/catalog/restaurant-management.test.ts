import { RestaurantDetails } from "@kade/proto/kade/catalog/v1/catalog_service";
import { describe, expect, it } from "vitest";
import { restaurantRow } from "./model.test.js";
import { detailsPatch } from "./restaurant-management.grpc.js";

describe("detailsPatch (UpdateRestaurantDetails)", () => {
  it("keeps current values for zero/empty fields, so partial updates are safe", () => {
    const row = restaurantRow();
    expect(detailsPatch(row, RestaurantDetails.fromPartial({}), undefined)).toEqual({});
    // The restaurant app sends prep minutes as 0: the ETA window must survive.
    expect(
      detailsPatch(
        row,
        RestaurantDetails.fromPartial({ phone: "+94 11 000 0000", prepMinMinutes: 0, prepMaxMinutes: 0 }),
        undefined,
      ),
    ).toEqual({
      phone: "+94 11 000 0000",
    });
  });

  it("applies set fields and prep windows that differ", () => {
    const patch = detailsPatch(
      restaurantRow(),
      RestaurantDetails.fromPartial({ name: " New name ", prepMinMinutes: 20, prepMaxMinutes: 30 }),
      undefined,
    );
    expect(patch).toEqual({ name: "New name", etaMinMinutes: 30, etaMaxMinutes: 45 });
  });
});
