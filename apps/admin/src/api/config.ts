// Which backend the console talks to. VITE_API_MODE=mock keeps the in-browser demo (no sign-in, a
// simulated Saturday dinner rush); live (the default) calls gateway-admin with a Keycloak token.
export const API_MODE: "mock" | "live" = import.meta.env.VITE_API_MODE === "mock" ? "mock" : "live";
export const isLive = API_MODE === "live";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8204").replace(/\/+$/, "");

/**
 * DEV ONLY: a gateway dev-bypass token ("dev:<userId>:<roles>") used instead of Keycloak sign-in,
 * for scripted runs against a gateway started with AUTH_DEV_BYPASS=true.
 */
export const DEV_TOKEN: string | undefined = import.meta.env.VITE_DEV_TOKEN || undefined;
