import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  SearchCodebaseOutputSchema,
  type SearchCodebaseOutput,
} from "@codeoracle/contracts";
import {
  diversifyByFilePath,
  mustRefuseSecretRetrieval,
  SEARCH_ABSOLUTE_SCORE_FLOOR,
  bestScore,
  lexicalEvidenceForKind,
  type LexicalMatchKind,
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
   * Dense cosine evidence for P0-B absolute floor.
   * Hybrid sparse-only hits set this to 0; legacy dense sets it equal to `score`.
   * Exact lexical hits raise this via {@link lexicalEvidenceForKind} (E1).
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
   * If the best **dense evidence** score is below this, return no results (P0-B).
   * Default SEARCH_ABSOLUTE_SCORE_FLOOR (0.35). Hybrid ranking still uses RRF
   * `score`; absolute no-match uses `evidenceScore` so sparse-only garbage empties.
   * Exact lexical matches credit evidence so symbol/path hits are not wiped (E1).
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

/**
 * Merge hybrid vector hits with the Postgres lexical lane (E1).
 * Exact lexical evidence raises the P0-B floor input; lexical-only ids are
 * inserted with a stable single-channel rank score.
 */
export function mergeLexicalIntoHits(
  hybrid: ChunkSearchHit[],
  lexical: LexicalChunkHit[],
): ChunkSearchHit[] {
  const byId = new Map<string, ChunkSearchHit>();
  for (const h of hybrid) {
    byId.set(h.id, { ...h });
  }

  for (const L of lexical) {
    const evidence = lexicalEvidenceForKind(L.matchKind);
    const existing = byId.get(L.id);
    if (existing) {
      existing.evidenceScore = Math.max(existing.evidenceScore, evidence);
      // Prefer keeping hybrid RRF score; nudge slightly when exact.
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

  const kindRank = (id: string): number => {
    const L = lexical.find((x) => x.id === id);
    if (!L) return 3;
    if (L.matchKind === "symbol_exact" || L.matchKind === "path_exact") return 0;
    if (L.matchKind === "path_suffix") return 1;
    if (L.matchKind === "symbol_soft") return 2;
    return 3;
  };

  return [...byId.values()].sort(
    (a, b) => kindRank(a.id) - kindRank(b.id) || b.score - a.score || a.id.localeCompare(b.id),
  );
}

/**
 * Semantic + lexical code search for MCP `search_codebase`.
 * Embed → Qdrant hybrid (dense/sparse RRF) ∥ Postgres lexical (E1) → merge →
 * hydrate → P0-A refuse → P0-B absolute evidence floor → diversify → Zod.
 *
 * Doc quota: when source hits remain in the over-fetch pool, documentation
 * paths cannot consume every display slot (Q1 R4 — dual-channel docs monopoly).
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

  // Production default is Postgres lexical. Test seams that omit lexicalSearch
  // get a no-op lane (do not hit stub db).
  const lexicalSearch =
    deps.lexicalSearch ??
    (opts.deps ? async () => [] : (args: { repoId: string; query: string; limit: number }) =>
      searchChunksLexical(opts.db, args));

  const [vector] = await opts.embed([query]);
  if (!vector || vector.length === 0) {
    throw new Error("searchCodebase: embedding provider returned an empty vector");
  }

  const [hybridHits, lexicalHits] = await Promise.all([
    deps.search({
      repoId: opts.repoId,
      vector,
      queryText: query,
      limit: fetchLimit,
      scoreThreshold,
    }),
    lexicalSearch({
      repoId: opts.repoId,
      query,
      limit: fetchLimit,
    }).catch((err: unknown) => {
      // Exact index unavailable: degrade to hybrid-only (E0 failure mode).
      console.warn(
        `[search_codebase] lexical lane unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [] as LexicalChunkHit[];
    }),
  ]);

  const hits = mergeLexicalIntoHits(hybridHits, lexicalHits);

  if (hits.length === 0) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const hydrated: SearchCodebaseOutput["results"] = [];
  const evidenceForFloor: Array<{ score: number }> = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    const filePath = row.filePath?.trim() ?? "";
    if (!filePath) continue; // citation mandatory
    // P0-A: refuse dotenv/secret path class + high-confidence secret payloads
    // even if stale vectors remain until full reindex.
    if (mustRefuseSecretRetrieval(filePath, row.content)) continue;

    evidenceForFloor.push({ score: hit.evidenceScore });
    hydrated.push({
      chunkId: row.id,
      filePath,
      symbolName: row.symbolName ?? null,
      content: row.content,
      score: hit.score,
      repoId: row.repoId,
    });
  }

  // P0-B: empty when best evidence is too weak (sparse-only → 0; exact lexical → 1).
  if (hydrated.length === 0 || bestScore(evidenceForFloor) < absoluteMinScore) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const results = diversifyByFilePath(hydrated, limit);
  return SearchCodebaseOutputSchema.parse({ results });
}

/** @internal test helper */
export type { LexicalMatchKind };
