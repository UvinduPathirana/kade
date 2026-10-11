import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { CONFIG, type Config } from "../platform/config.js";
import { LOGGER, type Logger } from "../platform/logger.js";

export class KeycloakUnavailableError extends Error {
  override name = "KeycloakUnavailableError";
}

export interface KeycloakTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
}

const TIMEOUT_MS = 5_000;

/**
 * Thin Keycloak admin REST client (plain fetch). Used for phone sign-in: find-or-create the user for a
 * phone number, then mint tokens for it.
 *
 * Minting: Keycloak's token exchange (impersonation) needs preview features and per-client
 * permissions that the dev realm doesn't enable. Instead, after the OTP is verified, we set a fresh
 * random password on the phone user (never stored or returned) and run a password grant for the
 * app's public client (direct-access grants are on in the dev realm). Same outcome: tokens for that
 * user with azp = the app's client id. Swap for token exchange in production.
 */
@Injectable()
export class KeycloakAdmin {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.KEYCLOAK_URL);
  }

  private get base(): string {
    if (!this.config.KEYCLOAK_URL) throw new KeycloakUnavailableError("KEYCLOAK_URL is not set");
    return this.config.KEYCLOAK_URL.replace(/\/$/, "");
  }

  private async adminToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const res = await this.post(
      `${this.base}/realms/${this.config.KEYCLOAK_ADMIN_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: "password",
        client_id: this.config.KEYCLOAK_ADMIN_CLIENT_ID,
        username: this.config.KEYCLOAK_ADMIN_USER,
        password: this.config.KEYCLOAK_ADMIN_PASSWORD,
      }),
    );
    const body = (await res.json()) as TokenResponse;
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async admin(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.adminToken();
    const res = await this.fetch(`${this.base}/admin/realms/${this.config.KEYCLOAK_REALM}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    if (res.status === 401) this.token = undefined;
    return res;
  }

  /** Keycloak user id for an exact username, or undefined. */
  async findUserId(username: string): Promise<string | undefined> {
    const res = await this.admin(`/users?exact=true&username=${encodeURIComponent(username)}`);
    await ok(res, "find user");
    const users = (await res.json()) as { id: string; username: string }[];
    return users.find((u) => u.username === username.toLowerCase())?.id;
  }

  /**
   * Finds or creates the user. firstName/lastName/email are filled because Keycloak's user profile
   * marks them required, and a user missing them can't get tokens (VERIFY_PROFILE).
   */
  async ensureUser(user: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<{ id: string; created: boolean }> {
    const existing = await this.findUserId(user.username);
    if (existing) return { id: existing, created: false };
    const res = await this.admin("/users", {
      method: "POST",
      body: JSON.stringify({ ...user, enabled: true, emailVerified: true }),
    });
    if (res.status === 409) {
      // Created concurrently by another verify; read it back.
      const id = await this.findUserId(user.username);
      if (id) return { id, created: false };
    }
    await ok(res, "create user");
    const id = res.headers.get("location")?.split("/").pop() ?? (await this.findUserId(user.username));
    if (!id) throw new KeycloakUnavailableError("created user but could not read its id");
    return { id, created: true };
  }

  /** Tokens for the user (see the class comment for why this is a password grant in dev). */
  async mintTokens(userId: string, username: string, clientId: string): Promise<KeycloakTokens> {
    const secret = randomBytes(24).toString("base64url");
    const reset = await this.admin(`/users/${userId}/reset-password`, {
      method: "PUT",
      body: JSON.stringify({ type: "password", value: secret, temporary: false }),
    });
    await ok(reset, "set password");
    const res = await this.post(
      `${this.base}/realms/${this.config.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        username,
        password: secret,
        scope: "openid",
      }),
    );
    const body = (await res.json()) as TokenResponse;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? "",
      expiresIn: body.expires_in,
      refreshExpiresIn: body.refresh_expires_in ?? 0,
    };
  }

  private async post(url: string, form: URLSearchParams): Promise<Response> {
    const res = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    await ok(res, "token request");
    return res;
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      this.logger.warn({ err, url: url.replace(/\?.*/, "") }, "keycloak request failed");
      throw new KeycloakUnavailableError("Keycloak is unreachable");
    }
  }
}

async function ok(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new KeycloakUnavailableError(`keycloak ${what} failed: ${res.status} ${text.slice(0, 200)}`);
}
