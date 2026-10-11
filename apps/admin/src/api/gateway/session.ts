// Live-mode start-up: finish a Keycloak redirect, make sure someone is signed in, and fill in ME
// (name, role, title, permissions) before the console renders. The token alone is enough to show
// the shell; gateway-admin's /v1/me adds the staff record's title and the effective permissions.
import { DEV_TOKEN } from "../config";
import { setMe, type Me } from "../me";
import type { Role } from "../types";
import { CALLBACK_PATH, completeSignIn, currentUser, identityOf, signIn } from "./auth";
import { GatewayError, get } from "./http";

export type SessionState = "ready" | "redirecting" | "noAccess";

const STAFF_ROLES: Role[] = ["admin", "ops", "finance", "support"];
const TITLES: Record<Role, string> = { admin: "Admin", ops: "Ops", finance: "Finance", support: "Support" };

/** Seeded Keycloak users read as U-5 etc., the same ids the gateway uses for staff. */
const staffId = (sub: string) => {
  const m = /^00000000-0000-7000-8005-(\d{12})$/.exec(sub);
  return m ? `U-${parseInt(m[1]!, 10)}` : sub;
};

export async function startSession(): Promise<SessionState> {
  if (window.location.pathname === CALLBACK_PATH) {
    let to: string;
    try {
      to = await completeSignIn();
    } catch {
      // Stale or replayed callback (back button, second tab): start a fresh sign-in.
      await signIn("/");
      return "redirecting";
    }
    window.history.replaceState(null, "", to);
  }

  if (!DEV_TOKEN) {
    const user = await currentUser();
    if (!user) {
      await signIn();
      return "redirecting";
    }
    const t = identityOf(user);
    const role = STAFF_ROLES.find((r) => t.roles.includes(r));
    if (!role) return "noAccess";
    const name = t.name || t.email || "Kadé staff";
    setMe({
      id: staffId(user.profile.sub),
      name,
      short: name.split(" ")[0] ?? name,
      email: t.email ?? "",
      role,
      title: TITLES[role],
      permissions: [],
    });
  }

  try {
    setMe(await get<Me>("/v1/me"));
  } catch (err) {
    if (err instanceof GatewayError && err.status === 403) return "noAccess";
    // Gateway unreachable: the shell still works from the token; pages show their own errors.
  }
  return "ready";
}
