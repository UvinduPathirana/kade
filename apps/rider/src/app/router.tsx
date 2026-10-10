import { createBrowserRouter } from "react-router";
import { RiderLayout } from "@/layout/RiderLayout";
import { AccountPage } from "@/pages/AccountPage";
import { DeliveredPage } from "@/pages/DeliveredPage";
import { DropoffPage } from "@/pages/DropoffPage";
import { EarningsPage } from "@/pages/EarningsPage";
import { GoOnlinePage } from "@/pages/GoOnlinePage";
import { JoinPage } from "@/pages/JoinPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PickupPage } from "@/pages/PickupPage";
import { TripDetailPage } from "@/pages/TripDetailPage";
import { TripsPage } from "@/pages/TripsPage";

export const router = createBrowserRouter([
  {
    element: <RiderLayout />,
    children: [
      { path: "/", element: <GoOnlinePage /> },
      { path: "/job/pickup", element: <PickupPage /> },
      { path: "/job/dropoff", element: <DropoffPage /> },
      { path: "/job/done", element: <DeliveredPage /> },
      { path: "/earnings", element: <EarningsPage /> },
      { path: "/trips", element: <TripsPage /> },
      { path: "/trips/:id", element: <TripDetailPage /> },
      { path: "/account", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  // Sign-up sits outside the signed-in shell
  { path: "/join", element: <JoinPage /> },
]);
