import { clockTime } from "@/api/orderStatus";
import type { Order } from "@/api/types";

/** "Tue 7 Oct, 8:05 pm" */
export const orderDate = (ms: number) =>
  `${new Date(ms).toLocaleDateString("en-LK", { weekday: "short", day: "numeric", month: "short" })}, ${clockTime(ms)}`;

/** "2× Cheese kottu, Faluda and 1 more" */
export function itemsSummary(order: Order, max = 2): string {
  const names = order.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name));
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
