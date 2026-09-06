/**
 * Path content class for retrieval display — language-agnostic, repo-agnostic.
 * Used by constrained top-K selection so dual-channel docs cannot consume every
 * unique-path slot when source hits remain in the ranked pool (Q1 R4 class).
 */

export type PathContentClass = "doc" | "source";

const DOC_EXT = /\.(md|mdx|rst|txt|adoc)$/i;

/**
 * Classify a repo-relative path as documentation vs source/other.
 * READMEs (any extension or bare name) count as docs.
 */
export function classifyPathContent(filePath: string): PathContentClass {
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized) return "source";
  const base = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  if (DOC_EXT.test(base)) return "doc";
  if (/^readme(\.|$)/i.test(base)) return "doc";
  return "source";
}

/**
 * Max documentation paths in a display window of size `limit` when source
 * candidates exist. Always ≥1 so a leading doc can survive; never ≥ limit
 * so at least one slot stays available for source when the pool has any.
 */
export function maxDocSlotsForLimit(limit: number): number {
  if (limit <= 0) return 0;
  if (limit === 1) return 1;
  return Math.max(1, Math.floor(limit / 2));
}
