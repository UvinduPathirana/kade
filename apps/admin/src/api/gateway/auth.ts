// Keycloak sign-in for live mode: OpenID Connect Authorization Code + PKCE (oidc-client-ts), public
// client admin-app. The whole console requires sign-in. Tokens are renewed with the refresh token
// before they expire.
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { DEV_TOKEN } from "../config";

const authority = import.meta.env.VITE_OIDC_AUTHORITY || "http://localhost:8080/realms/kade";
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID || "admin-app";

export const CALLBACK_PATH = "/auth/callback";

let manager: UserManager | undefined;

/** Created on first use, so mock mode never touches Keycloak. */
function userManager(): UserManager {
  manager ??= new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}/`,
    response_type: "code",
    scope: "openid profile email",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  return manager;
}

interface SignInState {
  returnTo: string;
}

/** Sends the browser to Keycloak; comes back to `returnTo` after the callback. */
export function signIn(returnTo = window.location.pathname + window.location.search): Promise<void> {
  return userManager().signinRedirect({ state: { returnTo } satisfies SignInState });
}

/** A signed-in user with a usable access token, renewing it if needed; null when sign-in is needed. */
export async function currentUser(): Promise<User | null> {
  const um = userManager();
  const user = await um.getUser();
  if (!user) return null;
  if (!user.expired) return user;
  return renew();
}

/** Uses the refresh token for a new access token; null (and signed out locally) when that fails. */
export async function renew(): Promise<User | null> {
  const um = userManager();
  try {
    return await um.signinSilent();
  } catch {
    await um.removeUser();
    return null;
  }
}

export async function accessToken(): Promise<string | null> {
  if (DEV_TOKEN) return DEV_TOKEN;
  return (await currentUser())?.access_token ?? null;
}

/** Finishes the redirect from Keycloak; resolves with where to go next. */
export async function completeSignIn(): Promise<string> {
  const user = await userManager().signinRedirectCallback();
  return (user.state as SignInState | undefined)?.returnTo || "/";
}

export async function signOut(): Promise<void> {
  if (DEV_TOKEN) return;
  const um = userManager();
  const user = await um.getUser();
  await um.removeUser();
  await um.signoutRedirect({ id_token_hint: user?.id_token });
}

export interface TokenIdentity {
  name?: string;
  email?: string;
  roles: string[];
}

/** Name and realm roles from the tokens, for the shell before (or without) the gateway's /v1/me. */
export function identityOf(user: User | null): TokenIdentity {
  if (!user) return { roles: [] };
  const p = user.profile;
  let roles: string[] = [];
  try {
    const payload = JSON.parse(
      atob(user.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as {
      realm_access?: { roles?: string[] };
    };
    roles = payload.realm_access?.roles ?? [];
  } catch {
    // Opaque token: the gateway still checks roles; the shell just shows fewer details.
  }
  return { name: p.name ?? p.preferred_username, email: p.email, roles };
}
