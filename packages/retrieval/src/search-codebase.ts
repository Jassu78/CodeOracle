import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  SearchCodebaseOutputSchema,
  type SearchCodebaseOutput,
} from "@codeoracle/contracts";
import { getChunksByIds, type ChunkRow, type Database } from "@codeoracle/db";
import { searchSimilarChunks } from "./store/qdrant.js";
import type { EmbedFn } from "./util.js";

export type ChunkSearchHit = { id: string; score: number };

export type SearchCodebaseDeps = {
  search: (opts: {
    repoId: string;
    vector: number[];
    queryText: string;
    limit: number;
    scoreThreshold: number;
  }) => Promise<ChunkSearchHit[]>;
  getByIds: (ids: string[]) => Promise<ChunkRow[]>;
};

export type SearchCodebaseOpts = {
  db: Database;
  qdrant: QdrantClient;
  embed: EmbedFn;
  repoId: string;
  query: string;
  topK?: number;
  scoreThreshold?: number;
  /** Test seam — production callers omit this. */
  deps?: SearchCodebaseDeps;
};

/**
 * Semantic code search for MCP `search_codebase`.
 * Embed → Qdrant (repo-scoped; hybrid RRF + post-fusion cutoff when collection
 * supports sparse) → Postgres hydrate → filePath citation → Zod. No LLM.
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
  };

  const [vector] = await opts.embed([query]);
  if (!vector || vector.length === 0) {
    throw new Error("searchCodebase: embedding provider returned an empty vector");
  }

  const hits = await deps.search({
    repoId: opts.repoId,
    vector,
    queryText: query,
    limit,
    scoreThreshold,
  });

  if (hits.length === 0) {
    return SearchCodebaseOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const results: SearchCodebaseOutput["results"] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    const filePath = row.filePath?.trim() ?? "";
    if (!filePath) continue; // citation mandatory

    results.push({
      chunkId: row.id,
      filePath,
      symbolName: row.symbolName ?? null,
      content: row.content,
      score: hit.score,
      repoId: row.repoId,
    });
  }

  return SearchCodebaseOutputSchema.parse({ results });
}
