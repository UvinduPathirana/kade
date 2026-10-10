import { createBrowserRouter } from "react-router";
import { RootLayout } from "./RootLayout";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage, NotBuiltYetPage } from "@/pages/NotFoundPage";
import { RestaurantPage } from "@/pages/RestaurantPage";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/restaurant/:id", element: <RestaurantPage /> },
      // Planned in PAGES.md; routed now so links from the built pages land somewhere honest
      ...["/checkout", "/orders", "/orders/live", "/account", "/browse", "/offers", "/plus"].map((path) => ({
        path,
        element: <NotBuiltYetPage />,
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
