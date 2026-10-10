import { Drawer } from "@kade/ui";
import { CartContents, CheckoutButton } from "./CartContents";
import { useCart } from "./store";

export function CartDrawer() {
  const open = useCart((s) => s.drawerOpen);
  const setOpen = useCart((s) => s.setDrawerOpen);
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      title="Your cart"
      closeLabel="Close cart"
      footer={<CheckoutButton />}
    >
      <CartContents />
    </Drawer>
  );
}
