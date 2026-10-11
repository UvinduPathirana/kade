import { Button, EmptyState } from "@kade/ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { completeSignIn, signIn } from "./auth";

/** Keycloak redirects here with the authorization code; exchange it, then go where we were. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    completeSignIn().then(
      (returnTo) => navigate(returnTo, { replace: true }),
      () => setFailed(true),
    );
  }, [navigate]);

  if (failed) {
    return (
      <main style={{ padding: 32 }}>
        <EmptyState
          title="Sign-in didn't finish"
          description="The sign-in link expired or was already used."
          action={<Button onClick={() => void signIn("/")}>Sign in again</Button>}
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
