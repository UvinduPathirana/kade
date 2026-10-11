import { useEffect } from "react";
import { isLive } from "@/api/config";
import { useActiveJob } from "@/api/queries";
import { useJob } from "./store";

const WAITING_FOR_FOOD_MS = 5_000;
const OTHERWISE_MS = 30_000;

/**
 * Live mode: keeps the active job in step with dispatch while it runs. At the restaurant it polls
 * every few seconds until the kitchen marks the food ready (the realtime "Food is ready" push
 * refetches at once); otherwise it checks now and then (drop-off note and the like).
 */
export function useJobSync() {
  const job = useJob((s) => s.job);
  const phase = useJob((s) => s.phase);
  const nudge = useJob((s) => s.jobNudgeAt);
  const active = isLive && !!job && (phase === "pickup" || phase === "dropoff");
  const waitingForFood = phase === "pickup" && !job?.foodReadyAt;
  const { data, refetch } = useActiveJob(active, waitingForFood ? WAITING_FOR_FOOD_MS : OTHERWISE_MS);

  useEffect(() => {
    if (active && nudge) void refetch();
  }, [active, nudge, refetch]);

  useEffect(() => {
    if (data) useJob.getState().syncJob(data);
  }, [data]);
}
