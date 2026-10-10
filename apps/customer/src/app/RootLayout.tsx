import { Outlet, ScrollRestoration } from "react-router";
import { AddressPicker } from "@/features/address/AddressPicker";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { OfflineBanner } from "@/layout/OfflineBanner";

export function RootLayout() {
  return (
    <>
      <Outlet />
      <CartDrawer />
      <AddressPicker />
      <OfflineBanner />
      <ScrollRestoration />
    </>
  );
}
