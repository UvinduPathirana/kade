/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" keeps every service in this browser (localStorage); "live" (default) calls gateway-merchant. */
  readonly VITE_API_MODE?: "mock" | "live";
  /** gateway-merchant base URL. Default http://localhost:8202. */
  readonly VITE_API_URL?: string;
  /** Comma-separated API modules that stay on the mock in live mode, e.g. "promotions,payouts". */
  readonly VITE_MOCK_MODULES?: string;
  /** Keycloak realm URL. Default http://localhost:8080/realms/kade. */
  readonly VITE_OIDC_AUTHORITY?: string;
  /** Keycloak client id. Default merchant-app. */
  readonly VITE_OIDC_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
