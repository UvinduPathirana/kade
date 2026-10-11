// Live mode: the cart stays a client-side store (instant, works signed out) and is copied to the cart
// service while signed in. On sign-in an empty device cart picks up the server cart (another device);
// otherwise the device cart wins and replaces the server copy.
import { useSession } from "@/features/account/session";
import { useCart, type CartLine, type CartRestaurant } from "@/features/cart/store";
import { api } from "../http";
import type { OrderMode } from "../types";

interface ServerCart {
  restaurant: (CartRestaurant & { area: string }) | null;
  lines: CartLine[];
  mode: OrderMode;
  groupId?: string;
}

const PUSH_DELAY_MS = 800;
let timer: ReturnType<typeof setTimeout> | undefined;
let applying = false;

function push() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!useSession.getState().user) return;
    const { restaurant, lines, mode } = useCart.getState();
    void api("PUT", "/v1/cart", {
      auth: "required",
      body: { restaurantId: lines.length ? (restaurant?.id ?? null) : null, lines, mode },
    }).catch(() => undefined); // best effort: the device cart is what checkout uses
  }, PUSH_DELAY_MS);
}

async function pullOrPush() {
  const local = useCart.getState();
  if (local.lines.length) return push();
  try {
    const server = await api<ServerCart>("GET", "/v1/cart", { auth: "required" });
    if (!server.restaurant || !server.lines.length || useCart.getState().lines.length) return;
    applying = true;
    const { area: _area, ...restaurant } = server.restaurant;
    void _area;
    useCart.getState().replaceWith(restaurant, server.lines, { groupId: server.groupId });
    useCart.getState().setMode(server.mode);
  } catch {
    /* cart service down: keep the device cart */
  } finally {
    applying = false;
  }
}

export function startCartSync(): void {
  if (useSession.getState().user) void pullOrPush();
  useSession.subscribe((s, prev) => {
    if (s.user && !prev.user) void pullOrPush();
  });
  useCart.subscribe((s, prev) => {
    if (applying || !useSession.getState().user) return;
    if (s.lines !== prev.lines || s.restaurant !== prev.restaurant || s.mode !== prev.mode) push();
  });
}
