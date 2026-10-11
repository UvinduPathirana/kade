import { Button, EmptyState } from "@kade/ui";
import { useEffect, useState, type ReactNode } from "react";
import { isLive } from "@/api/config";
import { currentUser, signIn } from "./auth";

type State = "checking" | "signedIn" | "redirecting" | "error";

/** The signed-in app: in live mode, nothing renders until Keycloak says who this is. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(isLive ? "checking" : "signedIn");

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    currentUser().then(
      (user) => {
        if (cancelled) return;
        if (user) return setState("signedIn");
        setState("redirecting");
        signIn().catch(() => !cancelled && setState("error"));
      },
      () => !cancelled && setState("error"),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "signedIn") return children;
  if (state === "error") {
    return (
      <main style={{ padding: 32 }}>
        <EmptyState
          title="Can't reach sign-in"
          description="Kadé sign-in isn't answering. Check the connection and try again."
          action={<Button onClick={() => window.location.reload()}>Try again</Button>}
        />
      </main>
    );
  }
  return (
    <main style={{ padding: 32 }} aria-busy="true">
      <p>Signing in…</p>
    </main>
  );
}
