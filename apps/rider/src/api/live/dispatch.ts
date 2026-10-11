// Dispatch over gateway-rider: availability, offers (polled; the gateway also proxies realtime
// pushes on /ws), every step of the job, and GPS. Job ids are dispatch delivery ids.
import { enc, get, post } from "../http";
import { NoOfferError, type CompleteDeliveryInput } from "../shared";
import type { LocationFix, MapPoint, Offer, Thumb, Trip } from "../types";

export async function setAvailability(input: {
  online: boolean;
  position: MapPoint;
}): Promise<{ cashAllowed: boolean }> {
  const res = await post<{ online: boolean; cashAllowed: boolean }>("/v1/availability", input);
  return { cashAllowed: res.cashAllowed };
}

/** The offer dispatch has open for this rider; NoOfferError when there is none yet. */
export async function requestOffer(_input: { from: MapPoint; cashAllowed: boolean }): Promise<Offer> {
  void _input; // dispatch knows the position (location) and the cash limit (ledger)
  const offer = await get<Offer | undefined>("/v1/offer");
  if (!offer) throw new NoOfferError();
  return offer;
}

/** Accepting turns the offer into the job: same shape, id = the delivery id. */
export async function acceptOffer(offer: Offer): Promise<Offer> {
  const job = await post<Offer>(`/v1/offers/${enc(offer.id)}/accept`);
  return { ...job, from: offer.from, offeredAt: offer.offeredAt, expiresAt: offer.expiresAt };
}

export async function declineOffer(input: { offerId: string; reason?: string }): Promise<void> {
  await post(`/v1/offers/${enc(input.offerId)}/decline`, { reason: input.reason });
}

/** The job dispatch has for this rider (kitchen readiness, note); null when there is none. */
export async function getActiveJob(): Promise<Offer | null> {
  return (await get<Offer | undefined>("/v1/job")) ?? null;
}

export async function arriveAtRestaurant(jobId: string): Promise<number> {
  return (await post<{ at: number }>(`/v1/jobs/${enc(jobId)}/arrived-restaurant`)).at;
}

export async function reportNotReady(
  job: Pick<Offer, "id" | "notReadyMinutes">,
): Promise<{ readyAt: number }> {
  return post<{ readyAt: number }>(`/v1/jobs/${enc(job.id)}/not-ready`);
}

export async function confirmPickup(input: {
  jobId: string;
  checkedItems: string[];
  sealed: boolean;
  totalItems: number;
}): Promise<number> {
  const res = await post<{ at: number }>(`/v1/jobs/${enc(input.jobId)}/picked-up`, {
    checkedItems: input.checkedItems,
    sealed: input.sealed,
  });
  return res.at;
}

export async function arriveAtCustomer(jobId: string): Promise<number> {
  return (await post<{ at: number }>(`/v1/jobs/${enc(jobId)}/arrived-customer`)).at;
}

export async function completeDelivery({
  job,
  proof,
  code,
  cashCollected,
}: CompleteDeliveryInput): Promise<Trip> {
  return post<Trip>(`/v1/jobs/${enc(job.id)}/complete`, {
    proof: proof.kind,
    code: proof.kind === "code" ? code : undefined,
    fileName: proof.kind === "photo" ? proof.fileName : undefined,
    cashCollected,
  });
}

export async function rateTrip(input: {
  tripId: string;
  customer?: Thumb;
  restaurant?: Thumb;
}): Promise<void> {
  await post(`/v1/trips/${enc(input.tripId)}/feedback`, {
    customer: input.customer,
    restaurant: input.restaurant,
  });
}

/** Map position (default) or the phone's GPS fix, forwarded to the location service. */
export async function reportLocation(input: LocationFix): Promise<void> {
  await post("/v1/location", { fixes: [{ ...input, at: Date.now() }] });
}
