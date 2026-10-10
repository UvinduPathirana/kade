// Pages other than the first screen load on first visit, keeping the initial download small
import { createBrowserRouter } from "react-router";
import { RestaurantLayout, type RouteHandle } from "@/layout/RestaurantLayout";
import { BoardPage } from "@/pages/BoardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

const handle = (title: string): RouteHandle => ({ title });

export const router = createBrowserRouter([
  {
    element: <RestaurantLayout />,
    children: [
      { path: "/", element: <BoardPage />, handle: handle("Live orders") },
      {
        path: "/orders/:id",
        lazy: async () => ({ Component: (await import("@/pages/TicketPage")).TicketPage }),
        handle: handle("Order ticket"),
      },
      {
        path: "/menu",
        lazy: async () => ({ Component: (await import("@/pages/MenuPage")).MenuPage }),
        handle: handle("Menu"),
      },
      {
        path: "/hours",
        lazy: async () => ({ Component: (await import("@/pages/HoursPage")).HoursPage }),
        handle: handle("Hours and busy mode"),
      },
      {
        path: "/promotions",
        lazy: async () => ({ Component: (await import("@/pages/PromotionsPage")).PromotionsPage }),
        handle: handle("Promotions"),
      },
      {
        path: "/payouts",
        lazy: async () => ({ Component: (await import("@/pages/PayoutsPage")).PayoutsPage }),
        handle: handle("Sales and payouts"),
      },
      {
        path: "/reviews",
        lazy: async () => ({ Component: (await import("@/pages/ReviewsPage")).ReviewsPage }),
        handle: handle("Reviews"),
      },
      {
        path: "/settings",
        lazy: async () => ({ Component: (await import("@/pages/SettingsPage")).SettingsPage }),
        handle: handle("Staff and settings"),
      },
      { path: "*", element: <NotFoundPage />, handle: handle("Page not found") },
    ],
  },
  // Outside the shell: people who aren't partners yet, or have signed out of this tablet
  { path: "/join", lazy: async () => ({ Component: (await import("@/pages/JoinPage")).JoinPage }) },
  {
    path: "/join/status",
    lazy: async () => ({ Component: (await import("@/pages/JoinStatusPage")).JoinStatusPage }),
  },
  {
    path: "/signed-out",
    lazy: async () => ({ Component: (await import("@/pages/SignedOutPage")).SignedOutPage }),
  },
]);
