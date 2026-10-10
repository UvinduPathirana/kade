import { jobPath, useJob, type Phase } from "./store";

/**
 * The active job when the rider is in the expected phase; otherwise where they should be instead,
 * so a stale link or a reload never shows the wrong step.
 */
export function useJobStep(expected: Phase) {
  const phase = useJob((s) => s.phase);
  const job = useJob((s) => s.job);
  const redirect = phase === expected ? null : (jobPath(phase) ?? "/");
  return { job: redirect ? undefined : job, redirect };
}
