import type { OrderMode } from "@/api/types";

/** Pickup is ready a little before a rider could deliver, never under 10 minutes. */
export const pickupMinutes = (eta: [number, number]) => Math.max(10, eta[0] - 5);

/** "15–25 min" for delivery, "Ready in 10 min" for pickup. */
export const etaLabel = (eta: [number, number], mode: OrderMode) =>
  mode === "delivery" ? `${eta[0]}–${eta[1]} min` : `Ready in ${pickupMinutes(eta)} min`;
