import { and, eq, ilike, or } from "drizzle-orm";
import {
  escapeIlikePattern,
  looksLikeFilePath,
  normalizeLexicalQuery,
  scoreLexicalRow,
  type LexicalMatchKind,
} from "@codeoracle/core-domain";
import type { Database } from "../client.js";
import { chunks } from "../schema/chunks.js";

export type LexicalChunkHit = {
  id: string;
  matchKind: LexicalMatchKind;
  /** Higher is better within the lexical lane (1 = strongest). */
  score: number;
};

/**
 * Indexed lexical lane over Postgres chunk **symbol/path** (E1).
 * Repo-scoped. No content `ILIKE` on the hot path (btree-friendly equality +
 * bounded path/symbol patterns). Re-rank with shared `scoreLexicalRow`.
 */
export async function searchChunksLexical(
  db: Database,
  opts: { repoId: string; query: string; limit?: number },
): Promise<LexicalChunkHit[]> {
  const q = normalizeLexicalQuery(opts.query);
  if (!q || !opts.repoId.trim()) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const pattern = `%${escapeIlikePattern(q)}%`;
  const pathLike = looksLikeFilePath(q);

  const rows = await db
    .select({
      id: chunks.id,
      filePath: chunks.filePath,
      symbolName: chunks.symbolName,
      content: chunks.content,
    })
    .from(chunks)
    .where(
      and(
        eq(chunks.repoId, opts.repoId),
        or(
          eq(chunks.symbolName, q),
          eq(chunks.filePath, q),
          ilike(chunks.symbolName, pattern),
          ilike(chunks.filePath, pattern),
        ),
      ),
    )
    .limit(Math.min(limit * 4, 80));

  const scored: LexicalChunkHit[] = [];
  for (const row of rows) {
    const hit = scoreLexicalRow(row, q);
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
