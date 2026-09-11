import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  SearchCodebaseOutputSchema,
  type SearchCodebaseOutput,
} from "@codeoracle/contracts";
import {
  diversifyByFilePath,
  mustRefuseSecretRetrieval,
  SEARCH_ABSOLUTE_SCORE_FLOOR,
  lexicalEvidenceForKind,
} from "@codeoracle/core-domain";
import {
  getChunksByIds,
  searchChunksLexical,
  type ChunkRow,
  type Database,
  type LexicalChunkHit,
} from "@codeoracle/db";
import { searchSimilarChunks } from "./store/qdrant.js";
import type { EmbedFn } from "./util.js";

export type ChunkSearchHit = {
  id: string;
  /** Ranking score: RRF for hybrid, dense cosine for legacy dense-only. */
  score: number;
  /**
   * Evidence for P0-B absolute floor (dense cosine and/or exact lexical credit).
   * Hybrid sparse-only hits set this to 0; exact lexical raises it (E1).
   */
  evidenceScore: number;
};

export type SearchCodebaseDeps = {
  search: (opts: {
    repoId: string;
    vector: number[];
    queryText: string;
    limit: number;
    scoreThreshold: number;
  }) => Promise<ChunkSearchHit[]>;
  getByIds: (ids: string[]) => Promise<ChunkRow[]>;
  /** E1 lexical lane — default Postgres `searchChunksLexical`. */
  lexicalSearch?: (opts: {
    repoId: string;
    query: string;
    limit: number;
  }) => Promise<LexicalChunkHit[]>;
};

export type SearchCodebaseOpts = {
  db: Database;
  qdrant: QdrantClient;
  embed: EmbedFn;
  repoId: string;
  query: string;
  topK?: number;
  scoreThreshold?: number;
  /**
   * Hits with evidence below this are dropped (P0-B + E1 companion filter).
   * Default SEARCH_ABSOLUTE_SCORE_FLOOR (0.35).
   */
  absoluteMinScore?: number;
  /** Test seam — production callers omit this. */
  deps?: SearchCodebaseDeps;
};

/** Over-fetch so filePath diversity can still fill topK after collapsing dupes. */
export function searchFetchLimit(topK: number): number {
  return Math.max(topK * 2, topK + 5);
}

/** RRF-like single-channel top score for lexical-only ids (k=2, rank 0). */
const LEXICAL_ONLY_RANK_SCORE = 1 / 3;

function isExactLexicalKind(kind: LexicalChunkHit["matchKind"]): boolean {
  return kind === "symbol_exact" || kind === "path_exact" || kind === "path_suffix";
}

/**
 * Merge hybrid vector hits with the Postgres lexical lane (E1 MVP).
 *
 * Policy (documented amendment to E0 3-channel RRF until E1.1):
 * - Exact lexical kinds sort ahead of hybrid-only ids.
 * - Soft/content lexical never outranks pure hybrid by kind alone — score order.
 * - Exact lexical evidence clears P0-B; each hit must still meet the absolute floor.
 */
export function mergeLexicalIntoHits(
  hybrid: ChunkSearchHit[],
  lexical: LexicalChunkHit[],
): ChunkSearchHit[] {
  const byId = new Map<string, ChunkSearchHit>();
  const lexicalById = new Map(lexical.map((L) => [L.id, L]));

  for (const h of hybrid) {
    byId.set(h.id, { ...h });
  }

  for (const L of lexical) {
    const evidence = lexicalEvidenceForKind(L.matchKind);
    const existing = byId.get(L.id);
    if (existing) {
      existing.evidenceScore = Math.max(existing.evidenceScore, evidence);
      if (evidence >= 1) {
        existing.score = Math.max(existing.score, LEXICAL_ONLY_RANK_SCORE);
      }
    } else {
      byId.set(L.id, {
        id: L.id,
        score: LEXICAL_ONLY_RANK_SCORE * L.score,
        evidenceScore: evidence,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    const aExact = isExactLexicalKind(lexicalById.get(a.id)?.matchKind ?? "content");
    const bExact = isExactLexicalKind(lexicalById.get(b.id)?.matchKind ?? "content");
    // Only boost when the id actually has an exact lexical hit.
    const aBoost = lexicalById.has(a.id) && aExact;
    const bBoost = lexicalById.has(b.id) && bExact;
    if (aBoost !== bBoost) return aBoost ? -1 : 1;
    return b.score - a.score || a.id.localeCompare(b.id);
  });
}

/**
 * Semantic + lexical code search for MCP `search_codebase`.
 * Lexical starts with embed; hybrid waits on the vector. Hydrate → P0-A refuse →
 * per-hit absolute evidence floor → diversify → Zod.
 */
export async function searchCodebase(opts: SearchCodebaseOpts): Promise<SearchCodebaseOutput> {
  const query = opts.query.trim();
  if (!query) {
    throw new Error("searchCodebase: query must be non-empty");
  }
  if (!opts.repoId.trim()) {
    throw new Error("searchCodebase: repoId must be non-empty");
  }

  const limit = opts.topK ?? 10;
  const scoreThreshold = opts.scoreThreshold ?? 0.35;
  const absoluteMinScore = opts.absoluteMinScore ?? SEARCH_ABSOLUTE_SCORE_FLOOR;
  const fetchLimit = searchFetchLimit(limit);

  const deps: SearchCodebaseDeps = opts.deps ?? {
    search: (args) =>
      searchSimilarChunks(opts.qdrant, {
        repoId: args.repoId,
        vector: args.vector,
        queryText: args.queryText,
        limit: args.limit,
        scoreThreshold: args.scoreThreshold,
      }),
    getByIds: (ids) => getChunksByIds(opts.db, ids),
    lexicalSearch: (args) => searchChunksLexical(opts.db, args),
  };

  const lexicalSearch =
    deps.lexicalSearch ??
    (opts.deps
      ? async () => []
      : (args: { repoId: string; query: string; limit: number }) =>
          searchChunksLexical(opts.db, args));

  // Start lexical immediately (no embed dependency); run embed in parallel.
  const lexicalPromise = lexicalSearch({
    repoId: opts.repoId,
    query,
    limit: fetchLimit,
  }).catch((err: unknown) => {
    console.warn(
      JSON.stringify({
        component: "search_codebase",
        event: "lexical_unavailable",
        repoId: opts.repoId,
        err: err instanceof Error ? err.message : String(err),
      }),
    );
    return [] as LexicalChunkHit[];
  });

  const embedPromise = opts.embed([query]);

  const [lexicalHits, embedVectors] = await Promise.all([lexicalPromise, embedPromise]);
  const vector = embedVectors[0];
  if (!vector || vector.length === 0) {
    throw new Error("searchCodebase: embedding provider returned an empty vector");
  }

  const hybridHits = await deps.search({
    repoId: opts.repoId,
    vector,
    queryText: query,
    limit: fetchLimit,
    scoreThreshold,
  });

  const hits = mergeLexicalIntoHits(hybridHits, lexicalHits);

  if (hits.length === 0) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const hydrated: SearchCodebaseOutput["results"] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    const filePath = row.filePath?.trim() ?? "";
    if (!filePath) continue;
    if (mustRefuseSecretRetrieval(filePath, row.content)) continue;

    // P0-B / E1: drop weak companions — each hit must clear the absolute floor.
    if (hit.evidenceScore < absoluteMinScore) continue;

    hydrated.push({
      chunkId: row.id,
      filePath,
      symbolName: row.symbolName ?? null,
      content: row.content,
      score: hit.score,
      repoId: row.repoId,
    });
  }

  if (hydrated.length === 0) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const results = diversifyByFilePath(hydrated, limit);
  return SearchCodebaseOutputSchema.parse({ results });
}
