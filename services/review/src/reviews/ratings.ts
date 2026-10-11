import type { ImprovementTip, RatingSummary, TagCount } from "@kade/proto/kade/review/v1/review_service";

/** Customer app RateOrder chips, plus what riders' summaries already show. */
export const PRAISE_TAGS = [
  "On time",
  "Friendly",
  "Careful with the food",
  "Followed my note",
  "Fast",
  "Found us easily",
];

/** Problems a customer can flag, with the coaching tip the rider sees. */
export const PROBLEM_TIPS: Record<string, { label: string; detail: (n: number) => string }> = {
  Late: {
    label: "Head out as soon as the food is ready",
    detail: (n) => `${n} ${plural(n, "customer")} said the order was late.`,
  },
  "Didn't call": {
    label: "Call when you're close",
    detail: (n) => `${n} ${plural(n, "customer")} asked for a call before you reached the gate.`,
  },
  "Food was damaged": {
    label: "Keep the bag level",
    detail: (n) => `${n} ${plural(n, "order")} arrived spilled or squashed. Use the bag's dividers.`,
  },
  "Didn't follow my note": {
    label: "Read the delivery note",
    detail: (n) => `${n} ${plural(n, "customer")} said their note was missed.`,
  },
  "Hard to reach": {
    label: "Keep your phone on loud",
    detail: (n) => `${n} ${plural(n, "customer")} couldn't get through to you.`,
  },
  Rude: {
    label: "A kind word goes a long way",
    detail: (n) => `${n} ${plural(n, "customer")} felt the handover was rushed or rude.`,
  },
};

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 40;
export const MAX_COMMENT = 1_000;
export const MAX_REPLY = 500;
export const REPLACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
/** Rider breakdown covers the latest ratings only (rider app: "last 100 ratings"). */
export const RECENT_WINDOW = 100;

export interface Baseline {
  count: number;
  starSum: number;
  /** index 0 = 5 stars … 4 = 1 star */
  breakdown: number[];
  compliments: { label: string; count: number }[];
  improve: { label: string; detail: string }[];
}

/** Counts by stars (index 0 = 5 stars) for a list of 1–5 star values. */
export function breakdownOf(stars: number[]): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const s of stars) if (s >= 1 && s <= 5) out[5 - s]! += 1;
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Restaurant summary: historical baseline plus every live rating. */
export function restaurantSummary(baseline: Baseline | undefined, liveStars: number[]): RatingSummary {
  const live = breakdownOf(liveStars);
  const count = (baseline?.count ?? 0) + liveStars.length;
  const sum = (baseline?.starSum ?? 0) + liveStars.reduce((a, b) => a + b, 0);
  return {
    average: count ? round2(sum / count) : 0,
    count,
    breakdown: live.map((n, i) => n + (baseline?.breakdown[i] ?? 0)),
  };
}

/**
 * Rider summary: overall average over everything, breakdown over the latest 100 ratings. When fewer
 * than 100 live ratings exist, the rest of the window comes from the baseline's last-100 shape.
 * `recentStars` is newest first.
 */
export function riderSummary(
  baseline: Baseline | undefined,
  allLiveCount: number,
  allLiveSum: number,
  recentStars: number[],
): RatingSummary {
  const window = recentStars.slice(0, RECENT_WINDOW);
  const live = breakdownOf(window);
  const fill = baseline ? scaleTo(baseline.breakdown, RECENT_WINDOW - window.length) : [0, 0, 0, 0, 0];
  const count = (baseline?.count ?? 0) + allLiveCount;
  const sum = (baseline?.starSum ?? 0) + allLiveSum;
  return {
    average: count ? round2(sum / count) : 0,
    count,
    breakdown: live.map((n, i) => n + fill[i]!),
  };
}

/** Scales counts to a new total with largest-remainder rounding, so the parts sum exactly. */
export function scaleTo(counts: number[], total: number): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum === 0 || total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * total) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    floors[i]! += 1;
  }
  return floors;
}

/** Compliment counts: baseline plus praise tags from live ratings, most common first. */
export function compliments(baseline: Baseline | undefined, liveTags: string[][]): TagCount[] {
  const counts = new Map<string, number>();
  for (const c of baseline?.compliments ?? []) counts.set(c.label, c.count);
  for (const tags of liveTags) {
    for (const tag of tags) if (!(tag in PROBLEM_TIPS)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Coaching tips from problem tags in the recent window, then the baseline's. */
export function improvementTips(baseline: Baseline | undefined, recentTags: string[][]): ImprovementTip[] {
  const counts = new Map<string, number>();
  for (const tags of recentTags.slice(0, RECENT_WINDOW)) {
    for (const tag of tags) if (tag in PROBLEM_TIPS) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const live = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => ({ label: PROBLEM_TIPS[tag]!.label, detail: PROBLEM_TIPS[tag]!.detail(n) }));
  const seen = new Set(live.map((t) => t.label));
  return [...live, ...(baseline?.improve ?? []).filter((t) => !seen.has(t.label))];
}

/** "Nadeesha P." from "Nadeesha Perera"; single names stay as they are. */
export function publicName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Kadé customer";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/**
 * A breakdown (index 0 = 5 stars) with `count` ratings averaging close to `average`: a skewed,
 * realistic shape. Used for seeded history.
 */
export function syntheticBreakdown(average: number, count: number): { breakdown: number[]; starSum: number } {
  // Start from a typical food-app shape and shift weight between 5 and 4/3 stars to hit the mean.
  let best = { breakdown: [count, 0, 0, 0, 0], diff: Infinity, starSum: 5 * count };
  for (let five = 0.4; five <= 0.97; five += 0.005) {
    const rest = 1 - five;
    const shares = [five, rest * 0.62, rest * 0.2, rest * 0.1, rest * 0.08];
    const breakdown = scaleTo(
      shares.map((s) => Math.round(s * 1_000_000)),
      count,
    );
    const starSum = breakdown.reduce((sum, n, i) => sum + n * (5 - i), 0);
    const diff = Math.abs(starSum / count - average);
    if (diff < best.diff) best = { breakdown, diff, starSum };
  }
  return { breakdown: best.breakdown, starSum: best.starSum };
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
