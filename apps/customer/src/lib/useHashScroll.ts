import { useEffect } from "react";
import { useLocation } from "react-router";

/** Client-side links like "/help#privacy" don't scroll on their own; this brings the section into view. */
export function useHashScroll(ready = true) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    // A linked question opens, so the answer is what people land on
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ block: "start" });
  }, [hash, ready]);
}
