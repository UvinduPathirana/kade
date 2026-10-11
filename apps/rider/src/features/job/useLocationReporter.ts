import { useEffect } from "react";
import { isLive } from "@/api/config";
import { reportLocation } from "@/api/dispatch";
import type { LocationFix } from "@/api/types";
import { currentPosition } from "./position";
import { useJob } from "./store";

const EVERY_MS = 5_000;
const useDeviceGps = import.meta.env.VITE_RIDER_GPS === "device";

/**
 * Live mode, while the rider is online: report where they are every few seconds. gateway-rider
 * streams it to the location service, which feeds dispatch matching and customer tracking.
 * By default the position on the illustrated map is sent (a laptop demo outside Colombo still gets
 * jobs); VITE_RIDER_GPS=device sends the phone's real GPS fix instead.
 */
export function useLocationReporter() {
  const online = useJob((s) => s.phase !== "offline");

  useEffect(() => {
    if (!isLive || !online) return;
    let gps: GeolocationPosition | undefined;
    const watch =
      useDeviceGps && "geolocation" in navigator
        ? navigator.geolocation.watchPosition(
            (p) => (gps = p),
            () => undefined,
            { enableHighAccuracy: true, maximumAge: 5_000 },
          )
        : undefined;

    const send = () => {
      const s = useJob.getState();
      if (s.phase === "offline") return;
      const jobId = s.job?.id;
      const fix: LocationFix = gps
        ? {
            lat: gps.coords.latitude,
            lng: gps.coords.longitude,
            heading: gps.coords.heading ?? undefined,
            speedMps: gps.coords.speed ?? undefined,
            accuracyM: gps.coords.accuracy,
            jobId,
          }
        : { point: currentPosition(s), jobId };
      // Positions are best effort: a missed one is replaced five seconds later.
      reportLocation(fix).catch(() => undefined);
    };
    send();
    const timer = window.setInterval(send, EVERY_MS);
    return () => {
      window.clearInterval(timer);
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
    };
  }, [online]);
}
