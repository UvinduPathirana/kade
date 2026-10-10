import type { OrderMode } from "@/api/types";

export const modeOptions: { value: OrderMode; label: string }[] = [
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Pickup" },
];
