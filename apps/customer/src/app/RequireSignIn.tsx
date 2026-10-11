import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { IS_LIVE } from "@/api/config";
import { useSession } from "@/features/account/session";

/**
 * Live mode: checkout, orders and support need a Kadé account (the gateway knows who's ordering).
 * Signed-out visitors go to sign-in and come back here afterwards. Mock mode lets everyone through.
 */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const signedIn = useSession((s) => !!s.user);
  const location = useLocation();
  if (!IS_LIVE || signedIn) return children;
  const next = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />;
}
