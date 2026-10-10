import { createBrowserRouter } from "react-router";
import { RestaurantLayout, type RouteHandle } from "@/layout/RestaurantLayout";
import { BoardPage } from "@/pages/BoardPage";
import { HoursPage } from "@/pages/HoursPage";
import { JoinPage } from "@/pages/JoinPage";
import { JoinStatusPage } from "@/pages/JoinStatusPage";
import { MenuPage } from "@/pages/MenuPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PayoutsPage } from "@/pages/PayoutsPage";
import { PromotionsPage } from "@/pages/PromotionsPage";
import { ReviewsPage } from "@/pages/ReviewsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SignedOutPage } from "@/pages/SignedOutPage";
import { TicketPage } from "@/pages/TicketPage";

const handle = (title: string): RouteHandle => ({ title });

export const router = createBrowserRouter([
  {
    element: <RestaurantLayout />,
    children: [
      { path: "/", element: <BoardPage />, handle: handle("Live orders") },
      { path: "/orders/:id", element: <TicketPage />, handle: handle("Order ticket") },
      { path: "/menu", element: <MenuPage />, handle: handle("Menu") },
      { path: "/hours", element: <HoursPage />, handle: handle("Hours and busy mode") },
      { path: "/promotions", element: <PromotionsPage />, handle: handle("Promotions") },
      { path: "/payouts", element: <PayoutsPage />, handle: handle("Sales and payouts") },
      { path: "/reviews", element: <ReviewsPage />, handle: handle("Reviews") },
      { path: "/settings", element: <SettingsPage />, handle: handle("Staff and settings") },
      { path: "*", element: <NotFoundPage />, handle: handle("Page not found") },
    ],
  },
  // Outside the shell: people who aren't partners yet, or have signed out of this tablet
  { path: "/join", element: <JoinPage /> },
  { path: "/join/status", element: <JoinStatusPage /> },
  { path: "/signed-out", element: <SignedOutPage /> },
]);
