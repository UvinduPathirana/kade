// Mock dispatch service (VITE_API_MODE=mock): hands out offers from a small pool and records each
// step of a delivery in this browser. Live: dispatch via gateway-rider.
import { DispatchError, OFFER_SECONDS, type CompleteDeliveryInput } from "../shared";
import type { LocationFix, MapPoint, Offer, Thumb, Trip } from "../types";
import { offerTemplates } from "./data";
import { latency, saveTrip } from "./rider";

const ROTATION_KEY = "kade.rider.offerRotation.v1";

/** Go online or offline. The mock has no fleet to join; cash rules come from the cash balance. */
export async function setAvailability(_input: {
  online: boolean;
  position: MapPoint;
}): Promise<{ cashAllowed: boolean }> {
  void _input;
  await latency(100);
  return { cashAllowed: true };
}

/** GPS goes nowhere in the mock. */
export async function reportLocation(_input: LocationFix): Promise<void> {
  void _input;
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

export async function declineOffer(_input: { offerId: string; reason?: string }): Promise<void> {
  void _input;
  await latency(150);
}

/** The mock keeps the job in this browser only, so there is nothing newer to fetch. */
export async function getActiveJob(): Promise<Offer | null> {
  await latency(100);
  return null;
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
export async function reportNotReady(
  job: Pick<Offer, "id" | "notReadyMinutes">,
): Promise<{ readyAt: number }> {
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
