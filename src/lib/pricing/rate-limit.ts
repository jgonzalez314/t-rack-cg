// A small in-memory limit on price lookups, so nobody can use this server to
// burn through the Pokemon TCG API's daily quota. It counts per server
// instance, which is enough to stop one client hammering the endpoint.

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 120;

const hits = new Map<string, { count: number; start: number }>();

/** True when this client may make another lookup now. */
export function allowLookup(client: string, now = Date.now()): boolean {
  const entry = hits.get(client);
  if (!entry || now - entry.start >= WINDOW_MS) {
    // Forget old clients now and then so the map stays small.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.start >= WINDOW_MS) hits.delete(k);
    }
    hits.set(client, { count: 1, start: now });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_PER_WINDOW;
}

export const RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW };
