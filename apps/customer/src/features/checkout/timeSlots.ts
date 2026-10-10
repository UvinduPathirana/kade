import { clockTime } from "@/api/orderStatus";

/** Half-hour slots from about an hour from now until 11 pm, for "Schedule for later". */
export function timeSlots(now = new Date()): { value: number; label: string }[] {
  const start = new Date(now);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(now);
  end.setHours(23, 0, 0, 0);
  const slots: { value: number; label: string }[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 30 * 60_000) {
    slots.push({ value: t, label: `Today, ${clockTime(t)}` });
  }
  // Late at night, offer tomorrow lunchtime instead of nothing
  if (!slots.length) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    for (const h of [11, 12, 13]) {
      tomorrow.setHours(h, 0, 0, 0);
      slots.push({ value: tomorrow.getTime(), label: `Tomorrow, ${clockTime(tomorrow.getTime())}` });
    }
  }
  return slots;
}

/** Amounts someone might hand over, so the rider brings change: the next round thousand, Rs 2,000, Rs 5,000. */
export function cashNotes(total: number): number[] {
  const nextThousand = Math.floor(total / 1000) * 1000 + 1000;
  return [...new Set([nextThousand, 2000, 5000])].filter((n) => n > total).sort((a, b) => a - b);
}
