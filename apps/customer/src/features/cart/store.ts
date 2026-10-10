// One cart for the whole app, saved in localStorage. Later this syncs with the cart/order service.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { plusActive } from "@/api/account";
import { usePlus } from "@/api/queries";
import type { OrderMode, Restaurant } from "@/api/types";
import { photos } from "@/lib/images";
import { computeTotals } from "./totals";

/** Snapshot of the restaurant taken when the first dish is added; the cart needs it without refetching. */
export type CartRestaurant = Pick<
  Restaurant,
  "id" | "name" | "imageId" | "eta" | "deliveryFee" | "discountPercent"
>;

/** The snapshot the cart keeps of a restaurant. */
export const cartSnapshot = (r: Restaurant): CartRestaurant => ({
  id: r.id,
  name: r.name,
  imageId: r.imageId,
  eta: r.eta,
  deliveryFee: r.deliveryFee,
  discountPercent: r.discountPercent,
});

export interface CartLine {
  /** itemId + choices + note: identical configurations merge into one line. */
  key: string;
  itemId: string;
  name: string;
  /** Price of one, including paid options. */
  unitPrice: number;
  qty: number;
  choices: string[];
  note: string;
}

export type NewLine = Omit<CartLine, "key">;

interface CartState {
  restaurant: CartRestaurant | null;
  lines: CartLine[];
  mode: OrderMode;
  /** Set when the cart holds a group order's dishes; the host places it at checkout. */
  groupId?: string;
  /** Not persisted: drawer visibility and the last line added (for the highlight). */
  drawerOpen: boolean;
  lastAdded: { key: string; at: number } | null;

  /** Adds a line. Returns false (and changes nothing) if the cart holds another restaurant's dishes. */
  add: (restaurant: CartRestaurant, line: NewLine, opts?: { replace?: boolean }) => boolean;
  setQty: (key: string, qty: number) => void;
  setMode: (mode: OrderMode) => void;
  setDrawerOpen: (open: boolean) => void;
  /** Replace the whole cart, e.g. "Order again" from a past order, or everyone's dishes in a group order. */
  replaceWith: (restaurant: CartRestaurant, lines: CartLine[], opts?: { groupId?: string }) => void;
  clear: () => void;
}

const lineKey = (l: NewLine) => [l.itemId, ...l.choices, l.note].join("|");

/** First visit starts with a small order so the cart isn't empty in the demo. */
const seed: Pick<CartState, "restaurant" | "lines"> = {
  restaurant: { id: 3, name: "Kompanna Short Eats", imageId: photos.buns, eta: [10, 20], deliveryFee: 120 },
  lines: [
    {
      key: "3-0-0|No chilli",
      itemId: "3-0-0",
      name: "Fish bun",
      unitPrice: 140,
      qty: 4,
      choices: [],
      note: "No chilli",
    },
    { key: "3-0-1|", itemId: "3-0-1", name: "Vegetable roti", unitPrice: 120, qty: 3, choices: [], note: "" },
    { key: "3-0-2|", itemId: "3-0-2", name: "Chicken patty", unitPrice: 160, qty: 2, choices: [], note: "" },
  ],
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...seed,
      mode: "delivery",
      drawerOpen: false,
      lastAdded: null,

      add(restaurant, line, { replace = false } = {}) {
        const state = get();
        const otherRestaurant = state.lines.length > 0 && state.restaurant?.id !== restaurant.id;
        if (otherRestaurant && !replace) return false;

        const lines = otherRestaurant || state.restaurant?.id !== restaurant.id ? [] : [...state.lines];
        const key = lineKey(line);
        const existing = lines.find((l) => l.key === key);
        const next = existing
          ? lines.map((l) => (l.key === key ? { ...l, qty: l.qty + line.qty } : l))
          : [...lines, { ...line, key }];
        set({
          restaurant,
          lines: next,
          lastAdded: { key, at: Date.now() },
          groupId: state.restaurant?.id === restaurant.id ? state.groupId : undefined,
        });
        return true;
      },
      setQty(key, qty) {
        set((s) => ({
          lines:
            qty <= 0
              ? s.lines.filter((l) => l.key !== key)
              : s.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
        }));
      },
      setMode: (mode) => set({ mode }),
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
      replaceWith: (restaurant, lines, opts) =>
        set({ restaurant, lines, lastAdded: null, groupId: opts?.groupId }),
      clear: () => set({ restaurant: null, lines: [], groupId: undefined }),
    }),
    {
      name: "kade.cart.v2",
      partialize: ({ restaurant, lines, mode, groupId }) => ({ restaurant, lines, mode, groupId }),
    },
  ),
);

/** Totals for the current cart, with the Kadé Plus delivery benefit when the customer has it. */
export function useCartTotals() {
  const { lines, restaurant, mode } = useCart(
    useShallow((s) => ({ lines: s.lines, restaurant: s.restaurant, mode: s.mode })),
  );
  const { data: plus } = usePlus();
  return computeTotals(lines, restaurant, mode, { plus: plusActive(plus) });
}

/** Sync carts between open tabs. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "kade.cart.v2") void useCart.persist.rehydrate();
  });
}
