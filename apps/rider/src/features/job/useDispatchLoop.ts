import { useToast } from "@kade/ui";
import { useEffect, useRef } from "react";
import { isLive } from "@/api/config";
import { setAvailability } from "@/api/dispatch";
import { useCashBalance, useRequestOffer } from "@/api/queries";
import { cashHolding } from "@/api/types";
import { useJob } from "./store";
import { useJobSync } from "./useJobSync";
import { useLocationReporter } from "./useLocationReporter";
import { useRealtimeNudge } from "./useRealtimeNudge";

/**
 * The rider's link to dispatch: while online, asks for a job when one is due (live: polls
 * dispatch's open offer every few seconds; mock: hands one out); while an offer is showing, ends it
 * honestly when its 30 seconds run out. Live mode also tells dispatch when the rider goes online
 * or offline, and reports their position.
 */
export function useDispatchLoop() {
  useAvailabilitySync();
  useLocationReporter();
  useRealtimeNudge();
  useJobSync();

  const phase = useJob((s) => s.phase);
  const nextOfferAt = useJob((s) => s.nextOfferAt);
  const offer = useJob((s) => s.offer);
  const position = useJob((s) => s.position);
  const { data: cash } = useCashBalance();
  const { mutate: requestOffer } = useRequestOffer();
  const toast = useToast();

  const cashAllowed = !cash || cashHolding(cash) < cash.limit;

  // Online: wait until the next offer is due, then ask dispatch
  useEffect(() => {
    if (phase !== "online" || !nextOfferAt) return;
    const id = window.setTimeout(
      () =>
        requestOffer(
          { from: position, cashAllowed },
          {
            onSuccess: (o) => {
              useJob.getState().offerReceived(o);
              navigator.vibrate?.([200, 100, 200]);
            },
            onError: () => useJob.getState().noOffer(),
          },
        ),
      Math.max(0, nextOfferAt - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [phase, nextOfferAt, position, cashAllowed, requestOffer]);

  // Offer showing: when time runs out it goes to the next rider
  useEffect(() => {
    if (phase !== "offer" || !offer) return;
    const id = window.setTimeout(
      () => {
        useJob.getState().offerEnded("missed");
        toast({
          title: "Offer missed",
          description: "It's gone to another rider. You're still online.",
        });
      },
      Math.max(0, offer.expiresAt - Date.now()),
    );
    return () => window.clearTimeout(id);
  }, [phase, offer, toast]);
}

/** Live: dispatch only offers jobs to riders it knows are online, so mirror the switch there. */
function useAvailabilitySync() {
  const online = useJob((s) => s.phase !== "offline");
  const sent = useRef<boolean | undefined>(undefined);
  const toast = useToast();

  useEffect(() => {
    if (!isLive || sent.current === online) return;
    sent.current = online;
    const { position } = useJob.getState();
    setAvailability({ online, position }).catch((e: Error) => {
      if (!online) return; // going offline is best effort
      sent.current = undefined;
      useJob.getState().goOffline();
      toast({ title: "Couldn't go online", description: e.message, tone: "error" });
    });
  }, [online, toast]);
}
