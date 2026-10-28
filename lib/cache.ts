import type { CheckInput, Report } from "@/lib/types";

/**
 * Remembers each result for 15 minutes, so checking the same project twice in a
 * row gives the same answer and doesn't pay for the same data twice.
 * It lives in server memory, so a different server instance may still run fresh.
 */
const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 300;
const store = new Map<string, { at: number; report: Report }>();

export const cacheKey = (i: CheckInput) =>
  [i.handle?.toLowerCase() ?? "", i.contract?.toLowerCase() ?? "", i.contract ? i.chain : ""].join("|");

export function getCached(i: CheckInput): Report | null {
  const hit = store.get(cacheKey(i));
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { store.delete(cacheKey(i)); return null; }
  return { ...hit.report, cachedAt: new Date(hit.at).toISOString() };
}

export function putCached(i: CheckInput, report: Report) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  store.set(cacheKey(i), { at: Date.now(), report });
}
