// Profile, documents and trips (dispatch) and ratings (review) over gateway-rider.
import { enc, get } from "../http";
import { NotFoundError } from "../shared";
import type { RatingsSummary, RiderDocument, RiderProfile, Trip } from "../types";

export const getProfile = () => get<RiderProfile>("/v1/profile");

export const listDocuments = () => get<RiderDocument[]>("/v1/documents");

export const listTrips = () => get<Trip[]>("/v1/trips");

export async function getTrip(id: string): Promise<Trip> {
  const trip = await get<Trip | null>(`/v1/trips/${enc(id)}`, { nullOn404: true });
  if (!trip) throw new NotFoundError("This trip isn't in your history.");
  return trip;
}

export const getRatings = () => get<RatingsSummary>("/v1/ratings");
