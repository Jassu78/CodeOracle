import {
  classifyPathContent,
  maxDocSlotsForLimit,
} from "./path-content-class.js";

/**
 * Keep the first (best-ranked) hit per filePath, with an optional documentation
 * quota so strong dual-channel docs cannot occupy every display slot when
 * source hits remain in the pool (Q1 R4 — doc dual monopoly).
 *
 * Algorithm (one pass + deferred fill): unique paths in rank order, then
 * greedy select under `maxDocSlots`; deferred docs fill only if slots remain.
 * If the unique pool has no source paths, the quota is lifted (doc-intent).
 *
 * Caller should over-fetch, then diversify down to the user limit.
 */
export function diversifyByFilePath<T extends { filePath: string }>(
  items: T[],
  limit: number,
  opts?: { maxDocSlots?: number },
): T[] {
  if (limit <= 0) return [];

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const path = item.filePath.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    unique.push(item);
  }

  const poolHasSource = unique.some(
    (h) => classifyPathContent(h.filePath) === "source",
  );
  const maxDocs = poolHasSource
    ? (opts?.maxDocSlots ?? maxDocSlotsForLimit(limit))
    : limit;

  const out: T[] = [];
  const deferredDocs: T[] = [];
  let docsTaken = 0;

  for (const item of unique) {
    if (out.length >= limit) break;
    if (classifyPathContent(item.filePath) === "doc") {
      if (docsTaken < maxDocs) {
        out.push(item);
        docsTaken += 1;
      } else {
        deferredDocs.push(item);
      }
      continue;
    }
    out.push(item);
  }

  for (const item of deferredDocs) {
    if (out.length >= limit) break;
    out.push(item);
  }

  return out;
}
