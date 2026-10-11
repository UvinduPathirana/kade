// Constants, errors and input types the screens use, the same whichever backend (mock or live)
// answers. The API modules (dispatch.ts, onboarding.ts, …) re-export them.
import type { Offer, ProofOfDelivery, VehicleType } from "./types";

// ---------- Errors ----------

/** Something the screen can say as is, e.g. "This trip isn't in your history." */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

/** Dispatch has no job for this rider right now (the loop asks again shortly). */
export class NoOfferError extends Error {
  constructor() {
    super("No job nearby right now.");
    this.name = "NoOfferError";
  }
}

// ---------- Dispatch ----------

/** Seconds a rider has to accept before the offer goes to the next rider. */
export const OFFER_SECONDS = 30;

export const declineReasons = [
  "Too far",
  "Pay is too low",
  "Don't want cash orders",
  "Heading home",
  "Vehicle problem",
] as const;

export interface CompleteDeliveryInput {
  job: Offer & { acceptedAt: number; arrivedAtRestaurantAt?: number; pickedUpAt?: number };
  proof: ProofOfDelivery;
  code?: string;
  cashCollected: number;
}

// ---------- Payouts ----------

export const depositPoints = [
  {
    name: "Kadé rider hub",
    where: "Kollupitiya, 12 Station Rd, Colombo 03",
    hours: "8 am to 10 pm, every day",
  },
  {
    name: "Commercial Bank cash deposit machine",
    where: "Any branch, with your reference",
    hours: "Open all day",
  },
  { name: "Cargills Food City counter", where: "Wellawatte and Bambalapitiya", hours: "8 am to 9 pm" },
];

// ---------- Onboarding ----------

export type DocKey = "licence" | "revenue" | "insurance" | "nicFront" | "nicBack";

export interface ApplicationInput {
  name: string;
  nic: string;
  phone: string;
  city: string;
  vehicle: VehicleType;
  documents: Partial<Record<DocKey, string>>;
  bank: { bank: string; branch: string; account: string; holder: string };
  lessons: string[];
}

export type ApplicationStatus =
  | { state: "none" }
  | { state: "inReview"; id: string; submittedAt: number; firstName: string }
  | { state: "needsFix"; id: string; doc: DocKey; docName: string; reason: string; firstName: string }
  | { state: "approved"; id: string; firstName: string };
