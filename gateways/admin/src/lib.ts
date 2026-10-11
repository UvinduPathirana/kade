// Small helpers shared by the route mappers: formatting that matches the console's copy, map
// positions inside a zone, cached lookups and soft (optional) upstream reads.
import type { GeoPoint } from "@kade/proto/kade/common/v1/types";
import type { Money } from "@kade/proto/kade/common/v1/money";
import type { FastifyBaseLogger as Logger } from "fastify";
import { toRupees } from "./money.js";

const lkr = new Intl.NumberFormat("en-LK", { maximumFractionDigits: 0 });

/** "Rs 1,150", exactly like @kade/ui formatRs. */
export const formatRs = (rupees: number) => `Rs ${lkr.format(Math.round(rupees))}`;

export const rs = (m: Money | undefined) => toRupees(m);
export const ms = (d: Date | undefined): number => (d ? d.getTime() : 0);
export const msOpt = (d: Date | undefined): number | undefined => (d ? d.getTime() : undefined);
/** ISO date ("2026-10-12") of an instant, in Asia/Colombo. */
export const isoDate = (d: Date | undefined): string =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(d) : "";
export const nonEmpty = (s: string | undefined) => (s ? s : undefined);

/** Deterministic 0–1 numbers from a string, so unplaced things don't jump between polls. */
export function hash01(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export interface ZoneShape {
  boundary: GeoPoint[];
}

/**
 * Where a point sits inside its zone on the console's illustrated map (0–1 each way, north up).
 * Uses the zone's polygon bounding box; without one (or without a point) it scatters
 * deterministically around the middle.
 */
export function zonePosition(zone: ZoneShape | undefined, p: GeoPoint | undefined, seed: string) {
  const ring = zone?.boundary ?? [];
  if (p && (p.lat || p.lng) && ring.length >= 3) {
    const lats = ring.map((g) => g.lat);
    const lngs = ring.map((g) => g.lng);
    const [minLat, maxLat, minLng, maxLng] = [
      Math.min(...lats),
      Math.max(...lats),
      Math.min(...lngs),
      Math.max(...lngs),
    ];
    if (maxLat > minLat && maxLng > minLng) {
      const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
      return {
        x: round3(clamp((p.lng - minLng) / (maxLng - minLng))),
        y: round3(clamp((maxLat - p.lat) / (maxLat - minLat))),
      };
    }
  }
  return { x: round3(0.25 + hash01(seed, 1) * 0.5), y: round3(0.25 + hash01(seed, 2) * 0.5) };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A value cached for `ttlMs`; concurrent callers share one load; a failed load keeps the old value. */
export class Cached<T> {
  private value: T | undefined;
  private at = 0;
  private loading: Promise<T> | undefined;
  constructor(private readonly ttlMs: number) {}

  async get(load: () => Promise<T>): Promise<T> {
    if (this.value !== undefined && Date.now() - this.at < this.ttlMs) return this.value;
    this.loading ??= load().then(
      (v) => {
        this.value = v;
        this.at = Date.now();
        this.loading = undefined;
        return v;
      },
      (err: unknown) => {
        this.loading = undefined;
        if (this.value !== undefined) return this.value;
        throw err;
      },
    );
    return this.loading;
  }

  invalidate(): void {
    this.at = 0;
  }
}

/** An optional enrichment: on failure, log and fall back instead of failing the whole response. */
export async function soft<T>(log: Logger, what: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    log.warn({ err: (err as Error).message, what }, "optional upstream read failed; continuing without it");
    return fallback;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; keeps order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Follows next_page_token until done (or `maxPages`). */
export async function allPages<T>(
  fetch: (pageToken: string) => Promise<{ items: T[]; next: string }>,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = [];
  let token = "";
  for (let i = 0; i < maxPages; i++) {
    const { items, next } = await fetch(token);
    out.push(...items);
    if (!next) break;
    token = next;
  }
  return out;
}

export const PAGE = 200;
