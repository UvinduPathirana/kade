// Shop orders: what the picker does when a product has run out. Remembered for next time.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Substitution } from "@/api/types";

export const substitutionOptions: { value: Substitution; label: string; detail: string }[] = [
  { value: "similar", label: "Replace with similar", detail: "Same size or bigger, never more expensive" },
  { value: "refund", label: "Refund it", detail: "Taken off your total" },
];

export const useSubstitution = create<{ value: Substitution; set: (v: Substitution) => void }>()(
  persist((set) => ({ value: "similar", set: (value) => set({ value }) }), { name: "kade.substitution.v1" }),
);
