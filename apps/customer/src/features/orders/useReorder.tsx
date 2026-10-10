import { ConfirmDialog } from "@kade/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Order } from "@/api/types";
import { useCart } from "@/features/cart/store";

/** "Order again": puts a past order's dishes in the cart, asking first if that would replace other dishes. */
export function useReorder() {
  const navigate = useNavigate();
  const replaceWith = useCart((s) => s.replaceWith);
  const cart = useCart((s) => s.restaurant);
  const hasLines = useCart((s) => s.lines.length > 0);
  const [pending, setPending] = useState<Order | null>(null);

  const go = (order: Order) => {
    const { area: _area, ...restaurant } = order.restaurant;
    void _area;
    replaceWith(restaurant, order.lines);
    navigate("/cart");
  };

  const reorder = (order: Order) => {
    if (hasLines && cart && cart.id !== order.restaurant.id) setPending(order);
    else go(order);
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title="Replace your cart?"
      description={`Your cart has dishes from ${cart?.name}. Ordering again from ${pending?.restaurant.name} will remove them.`}
      cancelLabel="Keep current cart"
      confirmLabel="Replace cart"
      onConfirm={() => pending && go(pending)}
    />
  );

  return { reorder, dialog };
}
