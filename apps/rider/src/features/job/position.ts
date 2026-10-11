import type { MapPoint } from "@/api/types";
import { DUPLICATION_X } from "@/features/map/geo";
import { DROPOFF_LEG_SECONDS, PICKUP_LEG_SECONDS, legProgress } from "./legs";
import type { useJob } from "./store";

/** The point `t` (0–1) of the way along geo.routePath(a, b): out to Duplication Road, along it, in. */
export function pointAlong(a: MapPoint, b: MapPoint, t: number): MapPoint {
  const corners = [a, { x: DUPLICATION_X, y: a.y }, { x: DUPLICATION_X, y: b.y }, b];
  const lengths = corners.slice(1).map((p, i) => Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y));
  let left = Math.max(0, Math.min(1, t)) * lengths.reduce((s, l) => s + l, 0);
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (left <= len || i === lengths.length - 1) {
      const from = corners[i]!;
      const to = corners[i + 1]!;
      const f = len ? Math.min(1, left / len) : 1;
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    left -= len;
  }
  return b;
}

type JobState = ReturnType<typeof useJob.getState>;

/** Where the rider marker is right now: moving along the leg during a job, else where they wait. */
export function currentPosition(s: Pick<JobState, "phase" | "job" | "position">, now = Date.now()): MapPoint {
  const { job } = s;
  if (s.phase === "pickup" && job) {
    if (job.arrivedAtRestaurantAt) return job.restaurant.point;
    return pointAlong(job.from, job.restaurant.point, legProgress(job.acceptedAt, PICKUP_LEG_SECONDS, now));
  }
  if (s.phase === "dropoff" && job) {
    if (job.arrivedAtCustomerAt) return job.customer.point;
    const start = job.pickedUpAt ?? now;
    return pointAlong(job.restaurant.point, job.customer.point, legProgress(start, DROPOFF_LEG_SECONDS, now));
  }
  return s.position;
}
