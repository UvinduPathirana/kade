// Keycloak sends people back here after signing in (Authorization Code + PKCE). We swap the code for
// tokens, load (or create) their Kadé profile through the gateway, then carry on to where they were.
import { Button, Container, EmptyState, useToast } from "@kade/ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { completeSignIn } from "@/api/auth";
import { getMe } from "@/api/live/account";
import { firstName, safeNext, useSession } from "@/features/account/session";
import { SiteHeader } from "@/layout/SiteHeader";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function AuthCallbackPage() {
  useDocumentTitle("Signing in");
  const navigate = useNavigate();
  const toast = useToast();
  const signIn = useSession((s) => s.signIn);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // The code can only be redeemed once (StrictMode runs effects twice in development).
    if (started.current) return;
    started.current = true;
    (async () => {
      const { next: rawNext } = await completeSignIn();
      const next = safeNext(rawNext);
      const me = await getMe();
      if (me.isNew) {
        navigate(`/signin?step=name&next=${encodeURIComponent(next)}`, {
          replace: true,
          state: { draft: me.user },
        });
        return;
      }
      signIn(me.user);
      toast({ title: `Signed in as ${firstName(me.user)}`, tone: "success" });
      navigate(next, { replace: true });
    })().catch(() => setFailed(true));
  }, [navigate, signIn, toast]);

  return (
    <>
      <SiteHeader minimal />
      <main id="main">
        <Container>
          {failed ? (
            <EmptyState
              title="We couldn't sign you in"
              description="The sign-in link may have expired, or Kadé couldn't be reached. Try again."
              action={<Button href="/signin">Try again</Button>}
            />
          ) : (
            <p role="status" style={{ padding: "64px 0" }}>
              Signing you in…
            </p>
          )}
        </Container>
      </main>
    </>
  );
}
