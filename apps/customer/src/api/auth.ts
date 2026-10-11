// Sign-in with Kadé (Keycloak): OpenID Connect Authorization Code + PKCE via oidc-client-ts.
// The browser goes to Keycloak's login page and back to /auth/callback; tokens live in localStorage
// and are refreshed with the refresh token before they expire. The gateway validates the access token.
import { UserManager, WebStorageStateStore, type User as OidcUser } from "oidc-client-ts";
import { KEYCLOAK_CLIENT, KEYCLOAK_URL } from "./config";

const env = import.meta.env as Record<string, string | undefined>;
/** DEV ONLY: a gateway AUTH_DEV_BYPASS token ("dev:<userId>:customer") instead of Keycloak. */
const DEV_TOKEN = env.VITE_DEV_TOKEN;

export const CALLBACK_PATH = "/auth/callback";

let manager: UserManager | undefined;

function userManager(): UserManager {
  if (!manager) {
    const origin = window.location.origin;
    manager = new UserManager({
      authority: KEYCLOAK_URL,
      client_id: KEYCLOAK_CLIENT,
      redirect_uri: `${origin}${CALLBACK_PATH}`,
      post_logout_redirect_uri: `${origin}/`,
      response_type: "code",
      scope: "openid profile email",
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      automaticSilentRenew: true,
      // Keycloak answers userinfo too, but the ID token already has the name and email.
      loadUserInfo: false,
    });
  }
  return manager;
}

interface SignInState {
  next: string;
}

/** Leaves the app for Keycloak's sign-in (or registration) page. */
export async function signInWithKeycloak(next: string, opts: { register?: boolean } = {}): Promise<void> {
  await userManager().signinRedirect({
    state: { next } satisfies SignInState,
    ...(opts.register ? { prompt: "create" } : {}),
  });
}

/** Handles /auth/callback. Returns where the person was headed. */
export async function completeSignIn(): Promise<{ next: string; user: OidcUser }> {
  const user = await userManager().signinRedirectCallback();
  const next = (user.state as SignInState | undefined)?.next ?? "/";
  return { next, user };
}

/** A valid access token, refreshing it if needed; null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (DEV_TOKEN) return DEV_TOKEN;
  const um = userManager();
  let user = await um.getUser();
  if (!user) return null;
  if (user.expired || (user.expires_in ?? 0) < 15) {
    try {
      user = await um.signinSilent();
    } catch {
      await um.removeUser();
      return null;
    }
  }
  return user?.access_token ?? null;
}

/** True when Keycloak tokens are stored (or a dev token is configured). */
export async function hasKeycloakSession(): Promise<boolean> {
  if (DEV_TOKEN) return true;
  const user = await userManager().getUser();
  return !!user && (!user.expired || !!user.refresh_token);
}

/** Ends the Keycloak session too, then comes back to the home page. */
export async function signOutKeycloak(): Promise<void> {
  if (DEV_TOKEN) return;
  const um = userManager();
  const user = await um.getUser();
  await um.removeUser();
  if (user?.id_token) {
    await um.signoutRedirect({ id_token_hint: user.id_token }).catch(() => undefined);
  }
}

/** Forget the tokens locally (e.g. the gateway said they're no longer valid). */
export async function dropKeycloakTokens(): Promise<void> {
  if (DEV_TOKEN) return;
  await userManager().removeUser();
}
