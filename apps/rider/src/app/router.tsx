// Pages other than the first screen load on first visit, keeping the initial download small
import { createBrowserRouter } from "react-router";
import { RiderLayout } from "@/layout/RiderLayout";
import { GoOnlinePage } from "@/pages/GoOnlinePage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    element: <RiderLayout />,
    children: [
      { path: "/", element: <GoOnlinePage /> },
      {
        path: "/job/pickup",
        lazy: async () => ({ Component: (await import("@/pages/PickupPage")).PickupPage }),
      },
      {
        path: "/job/dropoff",
        lazy: async () => ({ Component: (await import("@/pages/DropoffPage")).DropoffPage }),
      },
      {
        path: "/job/done",
        lazy: async () => ({ Component: (await import("@/pages/DeliveredPage")).DeliveredPage }),
      },
      {
        path: "/earnings",
        lazy: async () => ({ Component: (await import("@/pages/EarningsPage")).EarningsPage }),
      },
      { path: "/trips", lazy: async () => ({ Component: (await import("@/pages/TripsPage")).TripsPage }) },
      {
        path: "/trips/:id",
        lazy: async () => ({ Component: (await import("@/pages/TripDetailPage")).TripDetailPage }),
      },
      {
        path: "/account",
        lazy: async () => ({ Component: (await import("@/pages/AccountPage")).AccountPage }),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // Sign-up sits outside the signed-in shell
  { path: "/join", lazy: async () => ({ Component: (await import("@/pages/JoinPage")).JoinPage }) },
]);
