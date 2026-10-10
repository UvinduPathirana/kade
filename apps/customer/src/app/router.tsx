import { createBrowserRouter } from "react-router";
import { RootLayout } from "./RootLayout";
import { AccountPage } from "@/pages/AccountPage";
import { BrowsePage } from "@/pages/BrowsePage";
import { CartPage } from "@/pages/CartPage";
import { CategoryPage } from "@/pages/CategoryPage";
import { CheckoutPage } from "@/pages/CheckoutPage";
import { GiftsPage } from "@/pages/GiftsPage";
import { GroupOrderPage } from "@/pages/GroupOrderPage";
import { HelpPage } from "@/pages/HelpPage";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { OffersPage } from "@/pages/OffersPage";
import { OrderHelpPage } from "@/pages/OrderHelpPage";
import { OrderPage } from "@/pages/OrderPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { PlusPage } from "@/pages/PlusPage";
import { RestaurantPage } from "@/pages/RestaurantPage";
import { SearchPage } from "@/pages/SearchPage";
import { SignInPage } from "@/pages/SignInPage";
import { SupportPage } from "@/pages/SupportPage";
import { WelcomePage } from "@/pages/WelcomePage";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/welcome", element: <WelcomePage /> },
      { path: "/signin", element: <SignInPage /> },
      { path: "/search", element: <SearchPage /> },
      { path: "/browse", element: <BrowsePage /> },
      { path: "/category/:id", element: <CategoryPage /> },
      { path: "/offers", element: <OffersPage /> },
      { path: "/restaurant/:id", element: <RestaurantPage /> },
      { path: "/group/:id", element: <GroupOrderPage /> },
      { path: "/cart", element: <CartPage /> },
      { path: "/checkout", element: <CheckoutPage /> },
      { path: "/orders", element: <OrdersPage /> },
      { path: "/orders/:id", element: <OrderPage /> },
      { path: "/orders/:id/help", element: <OrderHelpPage /> },
      { path: "/help", element: <HelpPage /> },
      { path: "/support", element: <SupportPage /> },
      { path: "/account", element: <AccountPage /> },
      { path: "/plus", element: <PlusPage /> },
      { path: "/gifts", element: <GiftsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
