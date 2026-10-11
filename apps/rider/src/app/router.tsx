// Pages other than the first screen load on first visit, keeping the initial download small
import { createBrowserRouter } from "react-router";
import { AuthCallbackPage } from "@/auth/AuthCallbackPage";
import { CALLBACK_PATH } from "@/auth/auth";
import { RequireAuth } from "@/auth/RequireAuth";
import { RiderLayout } from "@/layout/RiderLayout";
import { GoOnlinePage } from "@/pages/GoOnlinePage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    // Live mode: everything in the shell needs a Keycloak sign-in (rider-app).
    element: (
      <RequireAuth>
        <RiderLayout />
      </RequireAuth>
    ),
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
  { path: CALLBACK_PATH, element: <AuthCallbackPage /> },
  { path: "/join", lazy: async () => ({ Component: (await import("@/pages/JoinPage")).JoinPage }) },
]);
