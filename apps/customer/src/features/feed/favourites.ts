import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Saved restaurants. Later synced to the customer's account. */
export const useFavourites = create<{ ids: number[]; toggle: (id: number) => void }>()(
  persist(
    (set) => ({
      ids: [2, 12],
      toggle: (id) =>
        set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
    }),
    { name: "kade.favourites.v1" },
  ),
);
