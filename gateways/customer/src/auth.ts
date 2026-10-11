import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config.js";

/** The caller, as forwarded to services in x-user-id / x-roles / x-outlet-id metadata. */
export interface Identity {
  userId: string;
  roles: string[];
  outletId?: string;
  /** True for AUTH_DEV_BYPASS identities; logged so they are never mistaken for real ones. */
  dev: boolean;
  /** Profile hints from the token (Keycloak `profile`/`email`/`phone` scopes), for first sign-in. */
  name?: string;
  email?: string;
  phone?: string;
}

export class AuthError extends Error {
  override name = "AuthError";
}

export interface Authenticator {
  /** Verifies a bearer token (without the "Bearer " prefix). Throws AuthError. */
  authenticate(token: string): Promise<Identity>;
}

// Realm roles that mean something to Kadé; Keycloak's defaults (offline_access, ...) are dropped.
const KADE_ROLES = new Set([
  "customer",
  "merchant_staff",
  "merchant_owner",
  "rider",
  "ops",
  "finance",
  "support",
  "admin",
]);

interface KeycloakClaims {
  sub?: string;
  azp?: string;
  realm_access?: { roles?: string[] };
  /** Custom claim (user attribute mapper) for merchant staff. */
  outlet_id?: string;
  name?: string;
  email?: string;
  phone_number?: string;
}

export function createAuthenticator(
  config: Pick<Config, "KEYCLOAK_ISSUER" | "KEYCLOAK_JWKS_URL" | "KEYCLOAK_CLIENTS" | "AUTH_DEV_BYPASS">,
  // Injectable for tests (createLocalJWKSet); production fetches and caches Keycloak's JWKS.
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(config.KEYCLOAK_JWKS_URL ?? `${config.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`),
    { timeoutDuration: 2_000, cooldownDuration: 30_000 },
  ),
): Authenticator {
  return {
    async authenticate(token) {
      if (token.startsWith("dev:")) {
        if (!config.AUTH_DEV_BYPASS) throw new AuthError("dev tokens are disabled");
        return parseDevToken(token);
      }
      let claims: KeycloakClaims;
      try {
        ({ payload: claims } = await jwtVerify<KeycloakClaims>(token, keys, {
          issuer: config.KEYCLOAK_ISSUER,
          algorithms: ["RS256"],
          clockTolerance: 5,
        }));
      } catch (err) {
        if (err instanceof joseErrors.JOSEError) throw new AuthError(err.code);
        throw err; // JWKS unreachable etc.: a 5xx, not the user's fault
      }
      if (!claims.sub) throw new AuthError("token has no subject");
      if (config.KEYCLOAK_CLIENTS.length > 0 && !config.KEYCLOAK_CLIENTS.includes(claims.azp ?? "")) {
        throw new AuthError("token was issued to another client");
      }
      return {
        userId: claims.sub,
        roles: (claims.realm_access?.roles ?? []).filter((r) => KADE_ROLES.has(r)),
        outletId: claims.outlet_id,
        dev: false,
        ...(claims.name ? { name: claims.name } : {}),
        ...(claims.email ? { email: claims.email } : {}),
        ...(claims.phone_number ? { phone: claims.phone_number } : {}),
      };
    },
  };
}

/** "dev:<userId>[:<role,role>[:<outletId>]]", e.g. "dev:dilini:customer". */
function parseDevToken(token: string): Identity {
  const [, userId, roles = "", outletId] = token.split(":");
  if (!userId) throw new AuthError("dev token needs a user id: dev:<userId>:<roles>");
  return {
    userId,
    roles: roles.split(",").filter((r) => KADE_ROLES.has(r)),
    outletId: outletId || undefined,
    dev: true,
  };
}
