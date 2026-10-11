// Where the app's data comes from. `mock` (the original in-browser demo data) or `live` (the customer
// gateway, which talks to the backend services). Set in apps/customer/.env*:
//   VITE_API_MODE=live|mock          default live
//   VITE_API_URL=http://localhost:8201
//   VITE_KEYCLOAK_URL=http://localhost:8080/realms/kade   VITE_KEYCLOAK_CLIENT=customer-app
const env = import.meta.env as Record<string, string | undefined>;

export const API_MODE: "live" | "mock" = env.VITE_API_MODE === "mock" ? "mock" : "live";
export const IS_LIVE = API_MODE === "live";
export const API_URL = (env.VITE_API_URL ?? "http://localhost:8201").replace(/\/$/, "");
export const KEYCLOAK_URL = (env.VITE_KEYCLOAK_URL ?? "http://localhost:8080/realms/kade").replace(/\/$/, "");
export const KEYCLOAK_CLIENT = env.VITE_KEYCLOAK_CLIENT ?? "customer-app";
