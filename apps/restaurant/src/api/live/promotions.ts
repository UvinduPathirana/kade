// Restaurant-funded offers over gateway-merchant (promotion OfferService).
import { enc, get, post } from "../http";
import type { Offer, OfferInput } from "../types";

export const listOffers = () => get<Offer[]>("/v1/offers");

export const createOffer = (input: OfferInput) => post<Offer>("/v1/offers", input);

export const endOffer = (id: string) => post<Offer>(`/v1/offers/${enc(id)}/end`);
