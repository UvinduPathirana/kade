import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** True when the person has asked the OS to reduce motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
