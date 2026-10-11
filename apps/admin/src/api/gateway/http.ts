// fetch wrapper for gateway-admin: bearer token, JSON, problem+json → ApiError with the message the
// gateway says is safe to show, one silent token renewal on 401, Idempotency-Key on writes.
import { ApiError } from "../errors";
import { API_URL, DEV_TOKEN } from "../config";
import { accessToken, renew, signIn } from "./auth";

interface Problem {
  title?: string;
  detail?: string;
  code?: string;
  status?: number;
}

const FALLBACK: Record<number, string> = {
  401: "Your session has ended. Sign in again.",
  403: "Your role doesn't allow this. Ask an admin if you need it.",
  404: "Not found. Refresh the page and try again.",
  503: "That part of Kadé isn't responding right now. Try again in a moment.",
  504: "That took too long. Try again in a moment.",
};

/** Thrown for every gateway error; `message` is safe to show. */
export class GatewayError extends ApiError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function send(method: string, path: string, body: unknown, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();
  try {
    return await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GatewayError(
      "Can't reach Kadé right now. Check your connection, then try again.",
      0,
      "NETWORK",
    );
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body, await accessToken());
  if (res.status === 401 && !DEV_TOKEN) {
    const user = await renew();
    if (!user) {
      await signIn();
      throw new GatewayError(FALLBACK[401]!, 401, "UNAUTHENTICATED");
    }
    res = await send(method, path, body, user.access_token);
  }
  if (!res.ok) {
    let p: Problem = {};
    try {
      p = (await res.json()) as Problem;
    } catch {
      // not problem+json (proxy error page): fall back to the status
    }
    const message =
      res.status === 403
        ? FALLBACK[403]!
        : p.detail || FALLBACK[res.status] || "That didn't work. Try again.";
    throw new GatewayError(message, res.status, p.code ?? `HTTP_${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);

/** Path segment encoding for ids that come from the URL bar. */
export const seg = (s: string | number) => encodeURIComponent(String(s));
