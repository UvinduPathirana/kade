import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, createAuthenticator } from "./auth.js";

const ISSUER = "http://localhost:8080/realms/kade";
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] };
});

function token(claims: Record<string, unknown>, issuer = ISSUER) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function auth(overrides: { clients?: string[]; bypass?: boolean } = {}) {
  return createAuthenticator(
    {
      KEYCLOAK_ISSUER: ISSUER,
      KEYCLOAK_JWKS_URL: undefined,
      KEYCLOAK_CLIENTS: overrides.clients ?? ["customer-app"],
      AUTH_DEV_BYPASS: overrides.bypass ?? false,
    },
    createLocalJWKSet(jwks),
  );
}

describe("createAuthenticator", () => {
  it("accepts a Keycloak token and keeps only Kadé realm roles", async () => {
    const t = await token({
      azp: "customer-app",
      realm_access: { roles: ["default-roles-kade", "offline_access", "customer"] },
    });
    expect(await auth().authenticate(t)).toEqual({
      userId: "user-1",
      roles: ["customer"],
      outletId: undefined,
      dev: false,
    });
  });

  it("passes the outlet claim through for merchant staff", async () => {
    const t = await token({
      azp: "merchant-app",
      realm_access: { roles: ["merchant_staff"] },
      outlet_id: "o-7",
    });
    expect(await auth({ clients: [] }).authenticate(t)).toMatchObject({ outletId: "o-7" });
  });

  it("rejects the wrong issuer, another client, and garbage", async () => {
    await expect(
      auth().authenticate(await token({ azp: "customer-app" }, "http://evil/realms/kade")),
    ).rejects.toThrow(AuthError);
    await expect(auth().authenticate(await token({ azp: "rider-app" }))).rejects.toThrow(/another client/);
    await expect(auth().authenticate("not.a.jwt")).rejects.toThrow(AuthError);
  });

  it("accepts dev tokens only with AUTH_DEV_BYPASS", async () => {
    await expect(auth().authenticate("dev:dilini:customer")).rejects.toThrow(/disabled/);
    expect(await auth({ bypass: true }).authenticate("dev:ruwan:merchant_owner,nonsense:o-1")).toEqual({
      userId: "ruwan",
      roles: ["merchant_owner"],
      outletId: "o-1",
      dev: true,
    });
  });
});
