import "@kade/ui/styles.css";
import { ToastProvider, UIProvider } from "@kade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { IS_LIVE } from "@/api/config";
import { listAddresses } from "@/api/addresses";
import { startCartSync } from "@/api/live/cartSync";
import { startRealtime } from "@/api/live/realtime";
import { AppLink } from "@/app/AppLink";
import { router } from "@/app/router";
import { initLiveSession, useSession } from "@/features/account/session";
import { useAddress } from "@/features/address/store";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
});

if (IS_LIVE) {
  initLiveSession();
  startCartSync();
  startRealtime(queryClient);
  // Someone else's orders, cards and credit must never show after a sign-out or account switch.
  useSession.subscribe((s, prev) => {
    if (s.user?.phone !== prev.user?.phone || !!s.user !== !!prev.user) queryClient.clear();
  });
  // On sign-in, deliver to the account's saved version of the current address ("home", "work", …).
  const adoptSavedAddress = () =>
    listAddresses()
      .then((saved) => {
        const current = useAddress.getState().current;
        const match = saved.find((a) => a.id === current.id);
        if (match) useAddress.getState().setCurrent(match);
      })
      .catch(() => undefined);
  if (useSession.getState().user) void adoptSavedAddress();
  useSession.subscribe((s, prev) => {
    if (s.user && !prev.user) void adoptSavedAddress();
  });
  // Delivery fee, distance and ETA depend on where the food is going.
  useAddress.subscribe((s, prev) => {
    if (s.current.pin?.x !== prev.current.pin?.x || s.current.pin?.y !== prev.current.pin?.y) {
      void queryClient.invalidateQueries({ queryKey: ["restaurants"] });
      void queryClient.invalidateQueries({ queryKey: ["restaurant"] });
    }
  });
}

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
