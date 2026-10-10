import { createBrowserRouter } from "react-router";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OpsLayout } from "./OpsLayout";

// The live dashboard loads with the shell; every other page is fetched the first time someone opens it.
export const router = createBrowserRouter([
  {
    element: <OpsLayout />,
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/orders", lazy: async () => ({ Component: (await import("@/pages/OrdersPage")).OrdersPage }) },
      {
        path: "/finance",
        lazy: async () => ({ Component: (await import("@/pages/FinancePage")).FinancePage }),
      },
      {
        path: "/restaurants",
        lazy: async () => ({ Component: (await import("@/pages/RestaurantsPage")).RestaurantsPage }),
      },
      { path: "/riders", lazy: async () => ({ Component: (await import("@/pages/RidersPage")).RidersPage }) },
      {
        path: "/customers",
        lazy: async () => ({ Component: (await import("@/pages/CustomersPage")).CustomersPage }),
      },
      { path: "/zones", lazy: async () => ({ Component: (await import("@/pages/ZonesPage")).ZonesPage }) },
      {
        path: "/promotions",
        lazy: async () => ({ Component: (await import("@/pages/PromotionsPage")).PromotionsPage }),
      },
      {
        path: "/support",
        lazy: async () => ({ Component: (await import("@/pages/SupportPage")).SupportPage }),
      },
      {
        path: "/content",
        lazy: async () => ({ Component: (await import("@/pages/ContentPage")).ContentPage }),
      },
      { path: "/team", lazy: async () => ({ Component: (await import("@/pages/TeamPage")).TeamPage }) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
