import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MapPoint, Offer, Trip } from "@/api/types";
import { HOME_BASE } from "@/features/map/geo";

/*
 * The rider's shift as one state machine, saved to localStorage so a reload mid-job lands on the
 * right screen:
 *
 *   offline ──goOnline──▶ online ──offerReceived──▶ offer ──accept──▶ pickup ──pickedUp──▶ dropoff
 *      ▲                    ▲  ▲                      │                                     │
 *      └──goOffline─────────┘  └──decline / missed────┘                                delivered
 *                              └────────────────────────────backOnline──────────────────────┘
 *
 * Server truth lives in the dispatch service; this store is the rider's local view of it.
 */

export type Phase = "offline" | "online" | "offer" | "pickup" | "dropoff" | "delivered";

export interface ActiveJob extends Offer {
  acceptedAt: number;
  arrivedAtRestaurantAt?: number;
  /** Kitchen's estimate after the rider reported the order wasn't ready. */
  readyAt?: number;
  checked: string[];
  sealedConfirmed: boolean;
  pickedUpAt?: number;
  arrivedAtCustomerAt?: number;
}

interface JobState {
  phase: Phase;
  onlineSince?: number;
  /** When dispatch will next look for a job for this rider. */
  nextOfferAt?: number;
  offer?: Offer;
  job?: ActiveJob;
  /** The trip just finished, for the delivered screen. */
  lastTrip?: Trip;
  position: MapPoint;
  missedToday: number;

  goOnline: () => void;
  goOffline: () => void;
  offerReceived: (offer: Offer) => void;
  /** Dispatch had nothing nearby; look again shortly. */
  noOffer: () => void;
  offerEnded: (how: "declined" | "missed") => void;
  accept: (offer: Offer) => void;
  arriveRestaurant: (at: number) => void;
  setReadyAt: (at: number | undefined) => void;
  toggleItem: (id: string) => void;
  setSealed: (sealed: boolean) => void;
  pickedUp: (at: number) => void;
  arriveCustomer: (at: number) => void;
  delivered: (trip: Trip) => void;
  backOnline: () => void;
}

const seconds = (min: number, max: number) => (min + Math.random() * (max - min)) * 1000;
/** First offer 5–10 s after going online; later ones 12–20 s after the last ended. */
const firstOfferAt = () => Date.now() + seconds(5, 10);
const laterOfferAt = () => Date.now() + seconds(12, 20);

const patchJob = (s: JobState, change: Partial<ActiveJob>) => (s.job ? { job: { ...s.job, ...change } } : {});

export const useJob = create<JobState>()(
  persist(
    (set) => ({
      phase: "offline",
      position: HOME_BASE,
      missedToday: 0,

      goOnline: () =>
        set((s) =>
          s.phase === "offline"
            ? { phase: "online", onlineSince: Date.now(), nextOfferAt: firstOfferAt() }
            : {},
        ),
      goOffline: () =>
        set((s) =>
          s.phase === "online" || s.phase === "offer" || s.phase === "delivered"
            ? {
                phase: "offline",
                offer: undefined,
                nextOfferAt: undefined,
                onlineSince: undefined,
                lastTrip: undefined,
              }
            : {},
        ),
      offerReceived: (offer) => set((s) => (s.phase === "online" ? { phase: "offer", offer } : {})),
      noOffer: () => set((s) => (s.phase === "online" ? { nextOfferAt: laterOfferAt() } : {})),
      offerEnded: (how) =>
        set((s) =>
          s.phase === "offer"
            ? {
                phase: "online",
                offer: undefined,
                nextOfferAt: laterOfferAt(),
                missedToday: s.missedToday + (how === "missed" ? 1 : 0),
              }
            : {},
        ),
      accept: (offer) =>
        set((s) =>
          s.phase === "offer"
            ? {
                phase: "pickup",
                offer: undefined,
                nextOfferAt: undefined,
                job: { ...offer, acceptedAt: Date.now(), checked: [], sealedConfirmed: false },
              }
            : {},
        ),
      arriveRestaurant: (at) => set((s) => patchJob(s, { arrivedAtRestaurantAt: at })),
      setReadyAt: (at) => set((s) => patchJob(s, { readyAt: at })),
      toggleItem: (id) =>
        set((s) =>
          s.job
            ? patchJob(s, {
                checked: s.job.checked.includes(id)
                  ? s.job.checked.filter((x) => x !== id)
                  : [...s.job.checked, id],
              })
            : {},
        ),
      setSealed: (sealed) => set((s) => patchJob(s, { sealedConfirmed: sealed })),
      pickedUp: (at) =>
        set((s) =>
          s.phase === "pickup" && s.job
            ? { phase: "dropoff", job: { ...s.job, pickedUpAt: at, readyAt: undefined } }
            : {},
        ),
      arriveCustomer: (at) => set((s) => patchJob(s, { arrivedAtCustomerAt: at })),
      delivered: (trip) =>
        set((s) =>
          s.phase === "dropoff"
            ? { phase: "delivered", job: undefined, lastTrip: trip, position: trip.dropoffPoint }
            : {},
        ),
      backOnline: () =>
        set((s) =>
          s.phase === "delivered"
            ? { phase: "online", lastTrip: undefined, nextOfferAt: firstOfferAt() }
            : {},
        ),
    }),
    {
      name: "kade.rider.job.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ phase, onlineSince, nextOfferAt, offer, job, lastTrip, position, missedToday }) => ({
        phase,
        onlineSince,
        nextOfferAt,
        offer,
        job,
        lastTrip,
        position,
        missedToday,
      }),
    },
  ),
);

/** The screen each job phase belongs on. */
export function jobPath(phase: Phase): string | null {
  if (phase === "pickup") return "/job/pickup";
  if (phase === "dropoff") return "/job/dropoff";
  if (phase === "delivered") return "/job/done";
  return null;
}
