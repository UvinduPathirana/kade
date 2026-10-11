// Typed fetch for the customer gateway (gateways/customer, OpenAPI at <API_URL>/openapi.json).
// Hand-written instead of generated so the app needs no extra dependencies; the paths and shapes
// below follow the gateway's OpenAPI document one to one (see live/*.ts).
import { accessToken } from "./auth";
import { API_URL } from "./config";
import { ApiError } from "./errors";

type Auth = "none" | "optional" | "required";

export interface RequestOptions {
  body?: unknown;
  /** none: never send a token; optional (default): send one if signed in; required: 401 without. */
  auth?: Auth;
  /** Mutations: a retry with the same key returns the first result. */
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

let onUnauthorized: () => void = () => undefined;
/** Called when the gateway rejects our token (session over): the app signs the person out. */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

interface Problem {
  code?: string;
  detail?: string;
  title?: string;
}

export async function api<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const auth = opts.auth ?? "optional";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth !== "none") {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (auth === "required") {
      onUnauthorized();
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const qs = opts.query
    ? new URLSearchParams(
        Object.entries(opts.query).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
      ).toString()
    : "";

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "We couldn't reach Kadé. Check your connection and try again.");
  }

  if (!res.ok) {
    let p: Problem = {};
    try {
      p = (await res.json()) as Problem;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && headers.Authorization) onUnauthorized();
    throw new ApiError(
      res.status,
      p.code ?? `HTTP_${res.status}`,
      p.detail ?? p.title ?? "Something went wrong on our side. Please try again.",
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
