import { useToast } from "@kade/ui";
import { useEffect } from "react";
import { useCashBalance, useRequestOffer } from "@/api/queries";
import { cashHolding } from "@/api/types";
import { useJob } from "./store";

/**
 * Stands in for the dispatch service's offer stream: while online, asks for a job when one is due;
 * while an offer is showing, ends it honestly when its 30 seconds run out.
 */
export function useDispatchLoop() {
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
