/**
 * Keep the first (best-ranked) hit per filePath so duplicate chunks from the
 * same doc cannot dominate top-K after hybrid fusion (Q1).
 * Caller should over-fetch, then diversify down to the user limit.
 */
export function diversifyByFilePath<T extends { filePath: string }>(
  items: T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const path = item.filePath.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(item);
  }
  return out;
}
