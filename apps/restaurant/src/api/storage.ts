// The mock services keep their data in localStorage so the demo survives a reload.
// Each real service owns its own database; nothing here outlives the mock.

export function readJson<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Corrupt or unavailable storage: start again from the seed.
  }
  const seeded = fallback();
  writeJson(key, seeded);
  return seeded;
}

export function writeJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full (large photo uploads) or blocked: keep working in memory for this session.
  }
}

/** A short wait so loading and pending states show up in the demo, as they will over the network. */
export const latency = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** Errors a service sends back with a message the screen can show as is. */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
