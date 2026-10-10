import { useEffect, useState } from "react";
import { simNow } from "@/api/client";

/** The demo clock, re-rendering every `ms` while enabled. */
export function useNow(ms = 1000, enabled = true): number {
  const [now, setNow] = useState(simNow);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(simNow()), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
  return now;
}

/** Whole seconds since a wall-clock timestamp (e.g. a query's dataUpdatedAt), ticking each second. */
export function useSecondsSince(ts: number): number {
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setWall(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((wall - ts) / 1000));
}
