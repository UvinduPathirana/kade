// The signed-in customer, kept on this device. Live mode: Keycloak holds the tokens (api/auth.ts) and
// this holds the profile the gateway returned; mock mode: the demo sign-in's user.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dropKeycloakTokens, hasKeycloakSession, signOutKeycloak } from "@/api/auth";
import { IS_LIVE } from "@/api/config";
import { setUnauthorizedHandler } from "@/api/http";
import type { User } from "@/api/types";

interface SessionState {
  user: User | null;
  signIn: (user: User) => void;
  /** Signs out here and, in live mode, ends the Keycloak session too. */
  signOut: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      signIn: (user) => set({ user }),
      signOut: () => {
        set({ user: null });
        if (IS_LIVE) void signOutKeycloak();
      },
    }),
    { name: "kade.session.v1" },
  ),
);

export const firstName = (user: User | null | undefined) => user?.name.trim().split(/\s+/)[0] ?? "";

/** Where to send someone after signing in: only paths inside the app. */
export const safeNext = (next: string | null) => (next && /^\/(?!\/)/.test(next) ? next : "/");

/**
 * Live mode: keep the stored profile and the Keycloak tokens in step. A profile without tokens (they
 * expired and couldn't be refreshed, or were cleared) means signed out; so does a 401 from the gateway.
 */
export function initLiveSession(): void {
  if (!IS_LIVE) return;
  setUnauthorizedHandler(() => {
    if (useSession.getState().user) useSession.setState({ user: null });
    void dropKeycloakTokens();
  });
  void hasKeycloakSession().then((ok) => {
    if (!ok && useSession.getState().user) useSession.setState({ user: null });
  });
}
