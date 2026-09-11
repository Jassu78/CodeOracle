import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { chunks } from "../schema/chunks.js";

export type LexicalMatchKind =
  | "symbol_exact"
  | "path_exact"
  | "path_suffix"
  | "symbol_soft"
  | "content";

export type LexicalChunkHit = {
  id: string;
  matchKind: LexicalMatchKind;
  /** Higher is better within the lexical lane (1 = strongest). */
  score: number;
};

function normalizeQuery(raw: string): string {
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

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function looksLikeFilePath(q: string): boolean {
  return q.includes("/") || /\.[a-z0-9]{1,8}$/i.test(q);
}

type ScoredRow = {
  id: string;
  filePath: string;
  symbolName: string | null;
  content: string;
};

function scoreRow(row: ScoredRow, q: string): LexicalChunkHit | null {
  const symbol = row.symbolName?.trim() ?? "";
  const path = row.filePath.trim();
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;

  if (symbol && symbol === q) {
    return { id: row.id, matchKind: "symbol_exact", score: 1 };
  }
  if (path === q || base === q) {
    return { id: row.id, matchKind: "path_exact", score: 0.98 };
  }
  if (path.endsWith("/" + q) || path.endsWith(q)) {
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

/**
 * Indexed lexical lane over Postgres chunk metadata/body (E1).
 * Repo-scoped. Prefer symbol/path exactness over content mush.
 */
export async function searchChunksLexical(
  db: Database,
  opts: { repoId: string; query: string; limit?: number },
): Promise<LexicalChunkHit[]> {
  const q = normalizeQuery(opts.query);
  if (!q || !opts.repoId.trim()) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const pattern = `%${escapeIlike(q)}%`;
  const pathLike = looksLikeFilePath(q);

  const conditions = [
    eq(chunks.repoId, opts.repoId),
    or(
      eq(chunks.symbolName, q),
      eq(chunks.filePath, q),
      ilike(chunks.symbolName, pattern),
      ilike(chunks.filePath, pattern),
      q.length >= 3 && q.length <= 96 ? ilike(chunks.content, pattern) : sql`false`,
    ),
  ];

  const fetchN = Math.min(limit * 4, 80);
  const rows = await db
    .select({
      id: chunks.id,
      filePath: chunks.filePath,
      symbolName: chunks.symbolName,
      content: chunks.content,
    })
    .from(chunks)
    .where(and(...conditions))
    .limit(fetchN);

  const scored: LexicalChunkHit[] = [];
  for (const row of rows) {
    const hit = scoreRow(row, q);
    if (hit) scored.push(hit);
  }

  scored.sort((a, b) => {
    if (pathLike) {
      const ap = a.matchKind.startsWith("path") ? 0 : 1;
      const bp = b.matchKind.startsWith("path") ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    return b.score - a.score || a.id.localeCompare(b.id);
  });

  const seen = new Set<string>();
  const out: LexicalChunkHit[] = [];
  for (const h of scored) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
