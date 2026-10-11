// Keycloak sign-in for live mode: OpenID Connect Authorization Code + PKCE (oidc-client-ts), public
// client rider-app. Tokens live in localStorage so the rider stays signed in across reloads (and
// mid-job); they're renewed with the refresh token before they expire.
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const authority = import.meta.env.VITE_OIDC_AUTHORITY || "http://localhost:8080/realms/kade";
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID || "rider-app";

export const CALLBACK_PATH = "/auth/callback";
// Signed out riders land on the sign-up page, as the mock did.
const SIGNED_OUT_PATH = "/join";

let manager: UserManager | undefined;

/** Created on first use, so mock mode never touches Keycloak. */
function userManager(): UserManager {
  manager ??= new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}${SIGNED_OUT_PATH}`,
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
  try {
    return await um.signinSilent();
  } catch {
    await um.removeUser();
    return null;
  }
}

export async function accessToken(): Promise<string | null> {
  return (await currentUser())?.access_token ?? null;
}

let callback: Promise<string> | undefined;

/** Finishes the redirect from Keycloak (once, even under StrictMode); resolves with where to go. */
export function completeSignIn(): Promise<string> {
  callback ??= userManager()
    .signinRedirectCallback()
    .then((user) => (user.state as SignInState | undefined)?.returnTo || "/");
  return callback;
}

export async function signOut(): Promise<void> {
  const um = userManager();
  const user = await um.getUser();
  await um.removeUser();
  await um.signoutRedirect({ id_token_hint: user?.id_token });
}

/** Display name from the ID token, e.g. "Nimal Jayasinghe". */
export async function signedInName(): Promise<string | undefined> {
  const user = await userManager().getUser();
  const p = user?.profile;
  return p?.name ?? p?.given_name ?? p?.preferred_username;
}
