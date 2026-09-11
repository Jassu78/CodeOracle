/**
 * Lexical / exact query helpers for E1 (fused retrieval).
 * Pure — no I/O. Used by Postgres lexical search + search_codebase merge.
 */

export type LexicalMatchKind =
  | "symbol_exact"
  | "path_exact"
  | "path_suffix"
  | "symbol_soft"
  | "content";

/** Dense-evidence credit so exact lexical hits clear P0-B absolute floor. */
export const LEXICAL_EVIDENCE_EXACT = 1;
/** Soft symbol / path substring — above SEARCH_ABSOLUTE_SCORE_FLOOR (0.35). */
export const LEXICAL_EVIDENCE_SOFT = 0.4;
/**
 * Content substring alone must not bypass the absolute floor (avoids mush).
 * Ranking still benefits when hybrid also retrieves the id.
 */
export const LEXICAL_EVIDENCE_CONTENT = 0;

export function lexicalEvidenceForKind(kind: LexicalMatchKind): number {
  switch (kind) {
    case "symbol_exact":
    case "path_exact":
    case "path_suffix":
      return LEXICAL_EVIDENCE_EXACT;
    case "symbol_soft":
      return LEXICAL_EVIDENCE_SOFT;
    case "content":
      return LEXICAL_EVIDENCE_CONTENT;
  }
}

/** Strip wrapping quotes used for literal searches. */
export function normalizeLexicalQuery(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === "`" && b === "`")) {
      return t.slice(1, -1).trim();
    }
  }
  return t;
}

/**
 * Escape `%`, `_`, `\` for PostgreSQL ILIKE when using ESCAPE '\'.
 */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function looksLikeFilePath(q: string): boolean {
  return q.includes("/") || /\.[a-z0-9]{1,8}$/i.test(q);
}
