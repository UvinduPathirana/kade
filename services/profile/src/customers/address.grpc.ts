import { Inject, Injectable } from "@nestjs/common";
import {
  AddressServiceService,
  type JoinWaitlistRequest,
  type JoinWaitlistResponse,
  type ListAddressesRequest,
  type ListAddressesResponse,
  type RemoveAddressRequest,
  type RemoveAddressResponse,
  type SaveAddressRequest,
  type SaveAddressResponse,
} from "@kade/proto/kade/profile/v1/profile_service";
import type { Address } from "@kade/proto/kade/common/v1/address";
import { waitlist } from "../db/schema.js";
import { Database } from "../platform/db/database.js";
import type { RequestContext } from "../platform/grpc/context.js";
import { invalidArgument } from "../platform/grpc/errors.js";
import { GrpcService, type GrpcHandlers } from "../platform/grpc/grpc-service.js";
import { assertCustomerAccess, requireCustomerId, requireId } from "../shared/access.js";
import { Downstream } from "../clients/downstream.js";
import { addressToProto, ProfileStore, type NewAddress } from "./profile-store.js";

const ADDRESS_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** kade.profile.v1.AddressService */
@GrpcService(AddressServiceService)
@Injectable()
export class AddressGrpcService implements GrpcHandlers<AddressServiceService> {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(Downstream) private readonly downstream: Downstream,
  ) {}

  async listAddresses(request: ListAddressesRequest, ctx: RequestContext): Promise<ListAddressesResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const rows = await this.store.listAddresses(this.database.db, id);
    return { addresses: rows.map(addressToProto) };
  }

  async saveAddress(request: SaveAddressRequest, ctx: RequestContext): Promise<SaveAddressResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const input = validateAddress(request.address);
    // Zone lookup happens outside the transaction (a network call must not hold row locks).
    if (input.lat != null && input.lng != null) {
      const zone = await this.downstream.resolveZone({ lat: input.lat, lng: input.lng });
      if (zone !== undefined) input.zoneId = zone;
    }
    return this.database.transaction(ctx, async (tx) => {
      await this.store.ensure(tx, { id });
      const row = await this.store.saveAddress(tx, id, input);
      return { address: addressToProto(row) };
    });
  }

  /** Idempotent: removing an address that's already gone succeeds. */
  async removeAddress(request: RemoveAddressRequest, ctx: RequestContext): Promise<RemoveAddressResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const addressId = requireId(request.addressId, "address_id", "ADDRESS_ID_REQUIRED");
    await this.database.transaction(ctx, (tx) => this.store.removeAddress(tx, id, addressId));
    return {};
  }

  async joinWaitlist(request: JoinWaitlistRequest, ctx: RequestContext): Promise<JoinWaitlistResponse> {
    const id = requireCustomerId(request.customerId);
    assertCustomerAccess(ctx, id);
    const placeId = requireId(request.placeId, "place_id", "PLACE_ID_REQUIRED");
    await this.database.db
      .insert(waitlist)
      .values({
        customerId: id,
        placeId,
        placeName: request.placeName.trim(),
        area: request.area.trim(),
        lat: request.location?.lat ?? null,
        lng: request.location?.lng ?? null,
      })
      .onConflictDoNothing();
    return {};
  }
}

export function validateAddress(a: Address | undefined): NewAddress {
  if (!a) throw invalidArgument("ADDRESS_REQUIRED", "address is required.", { field: "address" });
  const label = a.label.trim();
  const line = a.line.trim();
  if (!label)
    throw invalidArgument("ADDRESS_LABEL_REQUIRED", "Give this address a name.", { field: "address.label" });
  if (label.length > 40) {
    throw invalidArgument("ADDRESS_LABEL_TOO_LONG", "Keep the name under 40 characters.", {
      field: "address.label",
    });
  }
  if (!line)
    throw invalidArgument("ADDRESS_LINE_REQUIRED", "Enter the street address.", { field: "address.line" });
  if (line.length > 200 || a.note.length > 300) {
    throw invalidArgument("ADDRESS_TOO_LONG", "That address is too long.", { field: "address" });
  }
  if (a.id && !ADDRESS_ID.test(a.id)) {
    throw invalidArgument("ADDRESS_ID_INVALID", "That address id isn't valid.", { field: "address.id" });
  }
  const loc = a.location;
  if (loc && (Math.abs(loc.lat) > 90 || Math.abs(loc.lng) > 180)) {
    throw invalidArgument("LOCATION_INVALID", "That location isn't on the map.", {
      field: "address.location",
    });
  }
  return {
    id: a.id || undefined,
    label,
    line,
    area: a.area.trim(),
    note: a.note.trim(),
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    zoneId: a.zoneId.trim(),
  };
}
