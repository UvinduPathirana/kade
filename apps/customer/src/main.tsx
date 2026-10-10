import "@kade/ui/styles.css";
import { ToastProvider, UIProvider } from "@kade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppLink } from "@/app/AppLink";
import { router } from "@/app/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UIProvider linkComponent={AppLink}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
);
