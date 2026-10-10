import { Outlet, ScrollRestoration } from "react-router";
import { CartDrawer } from "@/features/cart/CartDrawer";

export function RootLayout() {
  return (
    <>
      <Outlet />
      <CartDrawer />
      <ScrollRestoration />
    </>
  );
}
