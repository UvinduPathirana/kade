/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" keeps every service in this browser (localStorage); "live" (default) calls gateway-rider. */
  readonly VITE_API_MODE?: "mock" | "live";
  /** gateway-rider base URL. Default http://localhost:8203. */
  readonly VITE_API_URL?: string;
  /** Comma-separated API modules that stay on the mock in live mode, e.g. "promotions,payouts". */
  readonly VITE_MOCK_MODULES?: string;
  /** Keycloak realm URL. Default http://localhost:8080/realms/kade. */
  readonly VITE_OIDC_AUTHORITY?: string;
  /** Keycloak client id. Default rider-app. */
  readonly VITE_OIDC_CLIENT_ID?: string;
  /**
   * "device" reports the phone's real GPS to the gateway. Default "map": the position on the
   * illustrated Colombo map, so a laptop demo outside Colombo still gets jobs.
   */
  readonly VITE_RIDER_GPS?: "device" | "map";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
