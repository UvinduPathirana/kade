// Mock rider service (VITE_API_MODE=mock): profile, documents, trip history and ratings from mock
// data plus trips completed in this browser (localStorage). Live: dispatch and review via gateway-rider.
import { dayKey } from "@/lib/time";
import { NotFoundError } from "../shared";
import type { RatingsSummary, RiderDocument, RiderProfile, Trip } from "../types";
import { documents, profile, seedRatings, seedTrips } from "./data";

const TRIPS_KEY = "kade.rider.trips.v1";

export const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

function readLocalTrips(): Trip[] {
  try {
    return JSON.parse(localStorage.getItem(TRIPS_KEY) ?? "[]") as Trip[];
  } catch {
    return [];
  }
}

/** Called by the dispatch mock when a delivery completes. */
export function saveTrip(trip: Trip) {
  localStorage.setItem(TRIPS_KEY, JSON.stringify([trip, ...readLocalTrips()]));
}

/** Every trip, newest first. Synchronous so other mock services can build on it. */
export function allTrips(now = Date.now()): Trip[] {
  return [...readLocalTrips(), ...seedTrips(now)].sort((a, b) => b.deliveredAt - a.deliveredAt);
}

export function tripsOn(day: string, now = Date.now()): Trip[] {
  return allTrips(now).filter((t) => dayKey(t.deliveredAt) === day);
}

export async function getProfile(): Promise<RiderProfile> {
  await latency(150);
  return profile;
}

export async function listDocuments(): Promise<RiderDocument[]> {
  await latency(150);
  return documents;
}

export async function listTrips(): Promise<Trip[]> {
  await latency();
  return allTrips();
}

export async function getTrip(id: string): Promise<Trip> {
  await latency(150);
  const trip = allTrips().find((t) => t.id === id);
  if (!trip) throw new NotFoundError("This trip isn't in your history.");
  return trip;
}

export async function getRatings(): Promise<RatingsSummary> {
  await latency();
  return seedRatings();
}
