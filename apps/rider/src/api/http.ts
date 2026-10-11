// The live API client: JSON over fetch to gateway-rider with the Keycloak access token.
// Errors come back as application/problem+json; `detail` is written for the screen, so it becomes
// the error message the components already show.
import { accessToken, signIn } from "@/auth/auth";
import { API_URL } from "./config";

/** A problem from the gateway: the HTTP status and its stable code ("OFFER_EXPIRED"). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface Options {
  body?: unknown;
  /** Answer `null` instead of throwing for 404 (e.g. a trip that isn't in the history). */
  nullOn404?: boolean;
  /** Read the body as text instead of JSON. */
  text?: boolean;
  /** Public route: don't attach a token or redirect to sign-in. */
  anonymous?: boolean;
}

const OFFLINE = "Can't reach Kadé right now. Check the connection and try again.";

export async function request<T>(method: Method, path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  if (!opts.anonymous) {
    const token = await accessToken();
    if (!token) {
      void signIn();
      throw new ApiError("Please sign in again.", 401, "UNAUTHENTICATED");
    }
    headers.Authorization = `Bearer ${token}`;
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  // Same key on a retry of this call would replay the original answer; a new call gets a new key.
  if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(OFFLINE, 0, "NETWORK");
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (opts.text ? await res.text() : await res.json()) as T;
  }
  if (res.status === 404 && opts.nullOn404) return null as T;

  let problem: { detail?: string; title?: string; code?: string } = {};
  try {
    problem = (await res.json()) as typeof problem;
  } catch {
    // Not problem+json (a proxy in the way): fall back to a generic message.
  }
  if (res.status === 401 && !opts.anonymous) void signIn();
  throw new ApiError(
    problem.detail ||
      problem.title ||
      (res.status >= 500 ? OFFLINE : "Something went wrong. Please try again."),
    res.status,
    problem.code ?? `HTTP_${res.status}`,
  );
}

export const get = <T>(path: string, opts?: Omit<Options, "body">) => request<T>("GET", path, opts);
export const post = <T>(path: string, body?: unknown, opts?: Options) =>
  request<T>("POST", path, { ...opts, body: body ?? {} });
export const put = <T>(path: string, body: unknown) => request<T>("PUT", path, { body });
export const del = <T>(path: string) => request<T>("DELETE", path);

export const enc = encodeURIComponent;
