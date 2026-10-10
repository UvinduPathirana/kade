import { formatRs, plural } from "@kade/ui";
import { useEffect, useRef } from "react";
import { itemCount } from "@/api/orders";
import type { Ticket } from "@/api/types";
import { useAnnouncer } from "./announcer";
import { playNewOrder, unlockAudio } from "./sound";
import { useSound } from "./store";

/** While any order is waiting, the ring repeats this often until someone accepts or rejects it. */
const REPEAT_MS = 20_000;

const describe = (t: Ticket) =>
  `New order #${t.id}: ${plural(itemCount(t), "item")} for ${t.mode}, ${formatRs(t.subtotal)}.`;

/**
 * Rings and announces new orders. Lives in the app shell so the kitchen hears orders on every page.
 * Sound plays only when the kitchen has it on and the browser has unlocked audio after a tap.
 */
export function useOrderAlerts(tickets: Ticket[] | undefined, now: number) {
  const announce = useAnnouncer((s) => s.announce);
  const { soundOn, unlocked, setUnlocked } = useSound();
  const seen = useRef<Map<string, Ticket["status"]> | null>(null);
  const warned = useRef(new Set<string>());
  const hasWaiting = !!tickets?.some((t) => t.status === "new");
  const canRing = soundOn && unlocked;

  // Any tap or key press on the page is the gesture browsers need; use the first one to unlock audio.
  useEffect(() => {
    if (!soundOn || unlocked) return;
    const unlock = () => void unlockAudio().then((ok) => ok && setUnlocked(true));
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundOn, unlocked, setUnlocked]);

  // Announce arrivals and missed orders by comparing with what we saw last time.
  useEffect(() => {
    if (!tickets) return;
    const previous = seen.current;
    seen.current = new Map(tickets.map((t) => [t.id, t.status]));
    const fresh = tickets.filter((t) => t.status === "new" && !previous?.has(t.id));
    const missed = tickets.filter((t) => t.status === "missed" && previous?.get(t.id) === "new");

    if (!previous) {
      if (fresh.length) announce(`${plural(fresh.length, "new order")} waiting to be accepted.`);
    } else {
      for (const t of fresh) announce(`${describe(t)} Accept within 3 minutes.`);
      for (const t of missed) announce(`Order #${t.id} was missed. The customer has been told and refunded.`);
    }
    if (fresh.length && canRing) playNewOrder();
  }, [tickets, announce, canRing]);

  // One warning when an order has a minute left.
  useEffect(() => {
    for (const t of tickets ?? []) {
      if (t.status === "new" && t.acceptBy - now <= 60_000 && !warned.current.has(t.id)) {
        warned.current.add(t.id);
        announce(`Order #${t.id} has 1 minute left to accept.`);
      }
    }
  }, [tickets, now, announce]);

  // Keep ringing while orders wait. Turning sound on with orders waiting rings straight away.
  useEffect(() => {
    if (!hasWaiting || !canRing) return;
    const id = window.setInterval(playNewOrder, REPEAT_MS);
    return () => window.clearInterval(id);
  }, [hasWaiting, canRing]);
}
