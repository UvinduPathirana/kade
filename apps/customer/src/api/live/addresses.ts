// Saved addresses (profile) and place search (search) against the customer gateway.
import { useSession } from "@/features/account/session";
import { api } from "../http";
import type { Place, SavedAddress } from "../types";
import { asAccountError } from "./account";

export const listAddresses = () => api<SavedAddress[]>("GET", "/v1/me/addresses", { auth: "required" });

export const saveAddress = (address: SavedAddress) =>
  api<SavedAddress>("PUT", `/v1/me/addresses/${encodeURIComponent(address.id)}`, {
    auth: "required",
    body: address,
  }).catch(asAccountError);

export const removeAddress = (id: string) =>
  api<void>("DELETE", `/v1/me/addresses/${encodeURIComponent(id)}`, { auth: "required" }).catch(
    asAccountError,
  );

export const searchPlaces = (query: string) =>
  query.trim().length < 2
    ? Promise.resolve([] as Place[])
    : api<Place[]>("GET", "/v1/places", { auth: "none", query: { q: query } });

export const joinWaitlist = (place: Place) =>
  api<void>("POST", "/v1/waitlist", { auth: useSession.getState().user ? "optional" : "none", body: place });
