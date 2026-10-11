import { Button, EmptyState } from "@kade/ui";
import { useEffect, useState, type ReactNode } from "react";
import { isLive } from "@/api/config";
import { APP_ROLES, currentUser, rolesOf, signIn, signOut } from "./auth";

type State = "checking" | "signedIn" | "redirecting" | "noAccess" | "error";

/** The signed-in app: in live mode, nothing renders until Keycloak says who this is. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(isLive ? "checking" : "signedIn");
  const [who, setWho] = useState("");

  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    currentUser().then(
      (user) => {
        if (cancelled) return;
        if (user) {
          if (rolesOf(user).some((r) => APP_ROLES.includes(r))) return setState("signedIn");
          const p = user.profile;
          setWho(p.name ?? p.preferred_username ?? p.email ?? "Someone else");
          return setState("noAccess");
        }
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
  if (state === "noAccess") {
    return (
      <main style={{ padding: 32 }}>
        <EmptyState
          title="This account isn't on a restaurant team"
          description={`${who} is signed in, but Kadé for restaurants is for restaurant owners and kitchen staff. Sign in with your restaurant account.`}
          action={<Button onClick={() => void signOut()}>Sign in as someone else</Button>}
        />
      </main>
    );
  }
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
