// Recent searches on this device. Later synced to the account so they follow you between devices.
import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX = 6;

interface RecentState {
  terms: string[];
  add: (term: string) => void;
  remove: (term: string) => void;
  clear: () => void;
}

export const useRecentSearches = create<RecentState>()(
  persist(
    (set) => ({
      terms: [],
      add: (term) => {
        const t = term.trim();
        if (!t) return;
        set((s) => ({
          terms: [t, ...s.terms.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX),
        }));
      },
      remove: (term) => set((s) => ({ terms: s.terms.filter((x) => x !== term) })),
      clear: () => set({ terms: [] }),
    }),
    { name: "kade.recent-searches.v1" },
  ),
);
