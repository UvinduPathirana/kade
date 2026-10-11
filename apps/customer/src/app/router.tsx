// Pages other than the first screen load on first visit, keeping the initial download small.
// Live mode: checkout, orders and support sit behind RequireSignIn.
import { createBrowserRouter } from "react-router";
import { RequireSignIn } from "./RequireSignIn";
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
      {
        path: "/auth/callback",
        lazy: async () => ({ Component: (await import("@/pages/AuthCallbackPage")).AuthCallbackPage }),
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
        lazy: async () => {
          const { CheckoutPage } = await import("@/pages/CheckoutPage");
          return {
            Component: () => (
              <RequireSignIn>
                <CheckoutPage />
              </RequireSignIn>
            ),
          };
        },
      },
      {
        path: "/orders",
        lazy: async () => {
          const { OrdersPage } = await import("@/pages/OrdersPage");
          return {
            Component: () => (
              <RequireSignIn>
                <OrdersPage />
              </RequireSignIn>
            ),
          };
        },
      },
      {
        path: "/orders/:id",
        lazy: async () => {
          const { OrderPage } = await import("@/pages/OrderPage");
          return {
            Component: () => (
              <RequireSignIn>
                <OrderPage />
              </RequireSignIn>
            ),
          };
        },
      },
      {
        path: "/orders/:id/help",
        lazy: async () => {
          const { OrderHelpPage } = await import("@/pages/OrderHelpPage");
          return {
            Component: () => (
              <RequireSignIn>
                <OrderHelpPage />
              </RequireSignIn>
            ),
          };
        },
      },
      { path: "/help", lazy: async () => ({ Component: (await import("@/pages/HelpPage")).HelpPage }) },
      {
        path: "/support",
        lazy: async () => {
          const { SupportPage } = await import("@/pages/SupportPage");
          return {
            Component: () => (
              <RequireSignIn>
                <SupportPage />
              </RequireSignIn>
            ),
          };
        },
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
