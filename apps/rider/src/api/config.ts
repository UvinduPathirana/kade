// Which backend the app talks to. VITE_API_MODE=mock keeps the in-browser mock services (no
// sign-in, data in localStorage); live (the default) calls gateway-rider with a Keycloak token.
export const API_MODE: "mock" | "live" = import.meta.env.VITE_API_MODE === "mock" ? "mock" : "live";
export const isLive = API_MODE === "live";

export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8203").replace(/\/+$/, "");

/**
 * Modules to keep on the mock while their service isn't running yet, e.g.
 * VITE_MOCK_MODULES=promotions,payouts. Everything else goes live.
 */
const mockModules = new Set(
  (import.meta.env.VITE_MOCK_MODULES ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
);

/** True when this API module should call the gateway. */
export const liveFor = (module: string) => isLive && !mockModules.has(module);
