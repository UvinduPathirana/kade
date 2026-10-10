import { createBrowserRouter } from "react-router";
import { RootLayout } from "./RootLayout";
import { HomePage } from "@/pages/HomePage";
import { CartPage } from "@/pages/CartPage";
import { CheckoutPage } from "@/pages/CheckoutPage";
import { NotFoundPage, NotBuiltYetPage } from "@/pages/NotFoundPage";
import { OrderPage } from "@/pages/OrderPage";
import { RestaurantPage } from "@/pages/RestaurantPage";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/restaurant/:id", element: <RestaurantPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/checkout", element: <CheckoutPage /> },
      { path: "/orders/:id", element: <OrderPage /> },
      // Planned in PAGES.md; routed now so links from the built pages land somewhere honest
      ...["/orders", "/account", "/browse", "/offers", "/plus", "/help"].map((path) => ({
        path,
        element: <NotBuiltYetPage />,
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
