// Dispatch service: offers jobs to riders and records each step of a delivery. Today a mock that hands
// out offers from a small pool; later the dispatch service pushes offers over a socket and these calls
// become POST /dispatch/offers/:id/{accept,decline}, POST /dispatch/jobs/:id/{arrived,picked-up,delivered}.
import { offerTemplates } from "./mock/data";
import { latency, saveTrip } from "./rider";
import type { MapPoint, Offer, ProofOfDelivery, Thumb, Trip } from "./types";

/** Seconds a rider has to accept before the offer goes to the next rider. */
export const OFFER_SECONDS = 30;

const ROTATION_KEY = "kade.rider.offerRotation.v1";

export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

/**
 * Ask dispatch for the next job near the rider. Riders over their cash limit only get card orders
 * until they deposit.
 */
export async function requestOffer({
  from,
  cashAllowed,
}: {
  from: MapPoint;
  cashAllowed: boolean;
}): Promise<Offer> {
  await latency(200);
  const pool = offerTemplates.filter((o) => cashAllowed || o.payment === "card");
  const turn = Number(localStorage.getItem(ROTATION_KEY) ?? "0");
  localStorage.setItem(ROTATION_KEY, String(turn + 1));
  const template = pool[turn % pool.length]!;
  const now = Date.now();
  return {
    ...template,
    id: `O-${now.toString(36)}`,
    from,
    offeredAt: now,
    expiresAt: now + OFFER_SECONDS * 1000,
  };
}

export async function acceptOffer(offer: Offer): Promise<Offer> {
  await latency(250);
  if (Date.now() > offer.expiresAt) {
    throw new DispatchError("This offer ended before it reached us. It's gone to another rider.");
  }
  return offer;
}

export const declineReasons = [
  "Too far",
  "Pay is too low",
  "Don't want cash orders",
  "Heading home",
  "Vehicle problem",
] as const;

export async function declineOffer(_input: { offerId: string; reason?: string }): Promise<void> {
  void _input;
  await latency(150);
}

/** Records arrival at the restaurant so waiting time can be paid. */
export async function arriveAtRestaurant(_jobId: string): Promise<number> {
  void _jobId;
  await latency(200);
  return Date.now();
}

/**
 * The rider says the food isn't ready. The restaurant app answers with the kitchen's estimate;
 * here it comes from the mock order.
 */
export async function reportNotReady(job: Pick<Offer, "notReadyMinutes">): Promise<{ readyAt: number }> {
  await latency(300);
  const minutes = job.notReadyMinutes || 3;
  return { readyAt: Date.now() + minutes * 60_000 };
}

export async function confirmPickup(input: {
  jobId: string;
  checkedItems: string[];
  sealed: boolean;
  totalItems: number;
}): Promise<number> {
  await latency(250);
  if (!input.sealed && input.checkedItems.length < input.totalItems) {
    throw new DispatchError("Tick every item against the bag, or confirm the bag is sealed.");
  }
  return Date.now();
}

export async function arriveAtCustomer(_jobId: string): Promise<number> {
  void _jobId;
  await latency(200);
  return Date.now();
}

export interface CompleteDeliveryInput {
  job: Offer & { acceptedAt: number; arrivedAtRestaurantAt?: number; pickedUpAt?: number };
  proof: ProofOfDelivery;
  code?: string;
  cashCollected: number;
}

export async function completeDelivery({
  job,
  proof,
  code,
  cashCollected,
}: CompleteDeliveryInput): Promise<Trip> {
  await latency(400);
  if (proof.kind === "code" && code !== job.deliveryCode) {
    throw new DispatchError("That code doesn't match. Ask the customer to read it from the Kadé app again.");
  }
  if (job.payment === "cash" && cashCollected < job.cashToCollect) {
    throw new DispatchError("Collect the full amount before finishing the delivery.");
  }
  const now = Date.now();
  const trip: Trip = {
    id: `J-${now.toString(36).toUpperCase()}`,
    orderNumber: job.orderNumber,
    restaurantName: job.restaurant.name,
    pickupArea: job.restaurant.area,
    dropoffArea: job.customer.area,
    customerFirstName: job.customer.firstName,
    km: job.toPickupKm + job.tripKm,
    pay: job.pay,
    payment: job.payment,
    cashCollected: job.payment === "cash" ? job.cashToCollect : 0,
    acceptedAt: job.acceptedAt,
    arrivedAtRestaurantAt: job.arrivedAtRestaurantAt ?? job.acceptedAt,
    pickedUpAt: job.pickedUpAt ?? now,
    deliveredAt: now,
    proof: proof.kind,
    from: job.from,
    pickupPoint: job.restaurant.point,
    dropoffPoint: job.customer.point,
  };
  saveTrip(trip);
  return trip;
}

export async function rateTrip(_input: {
  tripId: string;
  customer?: Thumb;
  restaurant?: Thumb;
}): Promise<void> {
  void _input;
  await latency(200);
}
