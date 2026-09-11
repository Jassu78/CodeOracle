/**
 * Lexical / exact query helpers for E1 (fused retrieval).
 * Pure — no I/O. Shared by Postgres lexical search + search_codebase merge.
 */

export type LexicalMatchKind =
  | "symbol_exact"
  | "path_exact"
  | "path_suffix"
  | "symbol_soft"
  | "content";

/** Dense-evidence credit so exact lexical hits clear P0-B absolute floor. */
export const LEXICAL_EVIDENCE_EXACT = 1;
/** Soft symbol — above SEARCH_ABSOLUTE_SCORE_FLOOR (0.35). */
export const LEXICAL_EVIDENCE_SOFT = 0.4;
/**
 * Content substring alone must not bypass the absolute floor (avoids mush).
 * E1 SQL does not scan content; kept for future FTS and merge typing.
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

/** Extension-only queries (`.ts`) must not path_suffix-match every file. */
export function isExtensionOnlyQuery(q: string): boolean {
  return /^\.[a-z0-9]{1,8}$/i.test(q.trim());
}

export type LexicalScoreInput = {
  id: string;
  filePath: string;
  symbolName: string | null;
  content: string;
};

export type LexicalScoreHit = {
  id: string;
  matchKind: LexicalMatchKind;
  score: number;
};

/**
 * Score one chunk row against a normalized lexical query.
 * Path suffix requires a `/` boundary (or full-path / basename equality).
 */
export function scoreLexicalRow(row: LexicalScoreInput, q: string): LexicalScoreHit | null {
  if (!q) return null;
  const symbol = row.symbolName?.trim() ?? "";
  const path = row.filePath.trim();
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;

  if (symbol && symbol === q) {
    return { id: row.id, matchKind: "symbol_exact", score: 1 };
  }
  if (path === q || base === q) {
    return { id: row.id, matchKind: "path_exact", score: 0.98 };
  }
  if (!isExtensionOnlyQuery(q) && path.endsWith("/" + q)) {
    return { id: row.id, matchKind: "path_suffix", score: 0.92 };
  }
  if (symbol && symbol.toLowerCase().includes(q.toLowerCase())) {
    return { id: row.id, matchKind: "symbol_soft", score: 0.75 };
  }
  if (q.length >= 3 && row.content.includes(q)) {
    return { id: row.id, matchKind: "content", score: 0.45 };
  }
  return null;
}
