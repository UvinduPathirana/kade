// Pages other than the first screen load on first visit, keeping the initial download small
import { createBrowserRouter } from "react-router";
import { RootLayout } from "./RootLayout";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      {
        path: "/welcome",
        lazy: async () => ({ Component: (await import("@/pages/WelcomePage")).WelcomePage }),
      },
      { path: "/signin", lazy: async () => ({ Component: (await import("@/pages/SignInPage")).SignInPage }) },
      { path: "/search", lazy: async () => ({ Component: (await import("@/pages/SearchPage")).SearchPage }) },
      { path: "/browse", lazy: async () => ({ Component: (await import("@/pages/BrowsePage")).BrowsePage }) },
      {
        path: "/category/:id",
        lazy: async () => ({ Component: (await import("@/pages/CategoryPage")).CategoryPage }),
      },
      { path: "/offers", lazy: async () => ({ Component: (await import("@/pages/OffersPage")).OffersPage }) },
      {
        path: "/restaurant/:id",
        lazy: async () => ({ Component: (await import("@/pages/RestaurantPage")).RestaurantPage }),
      },
      {
        path: "/group/:id",
        lazy: async () => ({ Component: (await import("@/pages/GroupOrderPage")).GroupOrderPage }),
      },
      { path: "/cart", lazy: async () => ({ Component: (await import("@/pages/CartPage")).CartPage }) },
      {
        path: "/checkout",
        lazy: async () => ({ Component: (await import("@/pages/CheckoutPage")).CheckoutPage }),
      },
      { path: "/orders", lazy: async () => ({ Component: (await import("@/pages/OrdersPage")).OrdersPage }) },
      {
        path: "/orders/:id",
        lazy: async () => ({ Component: (await import("@/pages/OrderPage")).OrderPage }),
      },
      {
        path: "/orders/:id/help",
        lazy: async () => ({ Component: (await import("@/pages/OrderHelpPage")).OrderHelpPage }),
      },
      { path: "/help", lazy: async () => ({ Component: (await import("@/pages/HelpPage")).HelpPage }) },
      {
        path: "/support",
        lazy: async () => ({ Component: (await import("@/pages/SupportPage")).SupportPage }),
      },
      {
        path: "/account",
        lazy: async () => ({ Component: (await import("@/pages/AccountPage")).AccountPage }),
      },
      { path: "/plus", lazy: async () => ({ Component: (await import("@/pages/PlusPage")).PlusPage }) },
      { path: "/gifts", lazy: async () => ({ Component: (await import("@/pages/GiftsPage")).GiftsPage }) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
