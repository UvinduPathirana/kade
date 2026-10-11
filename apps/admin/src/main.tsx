import "@kade/ui/styles.css";
import { ToastProvider, UIProvider } from "@kade/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { isLive } from "@/api/config";
import { AppLink } from "@/app/AppLink";
import { SessionScreen } from "@/app/SessionScreen";

// 4xx answers (no permission, not found, bad input) won't change on retry; network and 5xx might.
const retry = (failures: number, err: unknown) => {
  const status = (err as { status?: number }).status ?? 0;
  return !(status >= 400 && status < 500) && failures < 3;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry } },
});

const root = createRoot(document.getElementById("root")!);
const render = (node: ReactNode) =>
  root.render(
    <StrictMode>
      <UIProvider linkComponent={AppLink}>{node}</UIProvider>
    </StrictMode>,
  );

async function start() {
  // Live mode: the whole console needs a signed-in staff member (Keycloak, client admin-app).
  if (isLive) {
    const { startSession } = await import("@/api/gateway/session");
    try {
      const state = await startSession();
      if (state === "redirecting") return;
      if (state === "noAccess") return render(<SessionScreen kind="noAccess" />);
    } catch {
      return render(<SessionScreen kind="error" />);
    }
  }
  // The router is imported after ME is known, so every page sees the signed-in staff member.
  const { router } = await import("@/app/router");
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

void start();
