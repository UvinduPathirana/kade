// TanStack Query hooks: the only way pages read or change data from the mock services.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptOffer,
  arriveAtCustomer,
  arriveAtRestaurant,
  completeDelivery,
  confirmPickup,
  declineOffer,
  getActiveJob,
  rateTrip,
  reportNotReady,
  requestOffer,
} from "./dispatch";
import { getApplicationStatus, resubmitDocument, submitApplication } from "./onboarding";
import { getCashBalance, getEarnings, getQuests, getTodaySummary, listPayouts } from "./payouts";
import { getProfile, getRatings, getTrip, listDocuments, listTrips, NotFoundError } from "./rider";
import { listHelpTopics, messageCustomer, sendSupportMessage } from "./support";
import type { Period } from "./types";

export const keys = {
  profile: ["profile"] as const,
  documents: ["documents"] as const,
  trips: ["trips"] as const,
  trip: (id: string) => ["trips", id] as const,
  ratings: ["ratings"] as const,
  earnings: (p: Period) => ["earnings", p] as const,
  today: ["earnings", "todaySummary"] as const,
  quests: ["quests"] as const,
  cash: ["cash"] as const,
  payouts: ["payouts"] as const,
  help: ["help"] as const,
  application: ["application"] as const,
  job: ["job"] as const,
};

// ---------- Rider service ----------

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: getProfile, staleTime: Infinity });
export const useDocuments = () => useQuery({ queryKey: keys.documents, queryFn: listDocuments });
export const useTrips = () => useQuery({ queryKey: keys.trips, queryFn: listTrips });
export const useTrip = (id: string) =>
  useQuery({
    queryKey: keys.trip(id),
    queryFn: () => getTrip(id),
    retry: (n, e) => !(e instanceof NotFoundError) && n < 1,
  });
export const useRatings = () => useQuery({ queryKey: keys.ratings, queryFn: getRatings });

// ---------- Payouts service ----------

export const useEarnings = (p: Period) =>
  useQuery({ queryKey: keys.earnings(p), queryFn: () => getEarnings(p) });
export const useTodaySummary = () => useQuery({ queryKey: keys.today, queryFn: getTodaySummary });
export const useQuests = () => useQuery({ queryKey: keys.quests, queryFn: getQuests });
export const useCashBalance = () => useQuery({ queryKey: keys.cash, queryFn: getCashBalance });
export const usePayouts = () => useQuery({ queryKey: keys.payouts, queryFn: listPayouts });

// ---------- Dispatch service ----------

/**
 * Dispatch's view of the active job (kitchen readiness, the drop-off note). Polled every
 * `pollMs`; the realtime push ("Food is ready") refetches it at once.
 */
export const useActiveJob = (enabled: boolean, pollMs: number) =>
  useQuery({
    queryKey: keys.job,
    queryFn: getActiveJob,
    enabled,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
  });

export const useRequestOffer = () => useMutation({ mutationFn: requestOffer });
export const useAcceptOffer = () => useMutation({ mutationFn: acceptOffer });
export const useDeclineOffer = () => useMutation({ mutationFn: declineOffer });
export const useArriveAtRestaurant = () => useMutation({ mutationFn: arriveAtRestaurant });
export const useReportNotReady = () => useMutation({ mutationFn: reportNotReady });
export const useConfirmPickup = () => useMutation({ mutationFn: confirmPickup });
export const useArriveAtCustomer = () => useMutation({ mutationFn: arriveAtCustomer });
export const useRateTrip = () => useMutation({ mutationFn: rateTrip });

/** A finished delivery changes trips, earnings, quests and cash, so refresh them all. */
export const useCompleteDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: completeDelivery,
    onSuccess: () => {
      for (const key of [keys.trips, ["earnings"], keys.quests, keys.cash]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
};

// ---------- Support ----------

export const useHelpTopics = () => useQuery({ queryKey: keys.help, queryFn: listHelpTopics });
export const useSendSupportMessage = () => useMutation({ mutationFn: sendSupportMessage });
export const useMessageCustomer = () => useMutation({ mutationFn: messageCustomer });

// ---------- Onboarding ----------

/** Polls while the application is being reviewed, standing in for a push from the onboarding service. */
export const useApplicationStatus = () =>
  useQuery({
    queryKey: keys.application,
    queryFn: getApplicationStatus,
    refetchInterval: (q) => (q.state.data?.state === "inReview" ? 2000 : false),
  });

export const useSubmitApplication = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitApplication,
    onSuccess: (status) => qc.setQueryData(keys.application, status),
  });
};

export const useResubmitDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resubmitDocument,
    onSuccess: (status) => qc.setQueryData(keys.application, status),
  });
};
