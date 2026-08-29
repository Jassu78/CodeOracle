import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  FindDecisionOutputSchema,
  type FindDecisionOutput,
} from "@codeoracle/contracts";
import { getDecisionsByIds, type Database, type DecisionRow } from "@codeoracle/db";
import { searchSimilarDecisions } from "./store/decisions.js";
import { isHttpUrl, type EmbedFn } from "./util.js";

export type { EmbedFn } from "./util.js";

export type DecisionSearchHit = { id: string; score: number };

export type FindDecisionDeps = {
  search: (opts: {
    repoId: string;
    vector: number[];
    limit: number;
    scoreThreshold: number;
  }) => Promise<DecisionSearchHit[]>;
  getByIds: (ids: string[]) => Promise<DecisionRow[]>;
};

export type FindDecisionOpts = {
  db: Database;
  qdrant: QdrantClient;
  embed: EmbedFn;
  repoId: string;
  topic: string;
  includeHistory?: boolean;
  /** Max candidates from Qdrant before Postgres hydrate. Default 8. */
  limit?: number;
  /**
   * Cosine score floor for topic search. Looser than supersede (~0.75):
   * query phrasing rarely matches stored topic embeddings that tightly.
   */
  scoreThreshold?: number;
  /** Test seam — production callers omit this. */
  deps?: FindDecisionDeps;
};

/**
 * Semantic decision lookup for MCP `find_decision`.
 * Embed → Qdrant (repo-scoped) → Postgres hydrate → citation filter → Zod.
 * No LLM in this path.
 */
export async function findDecision(opts: FindDecisionOpts): Promise<FindDecisionOutput> {
  const topic = opts.topic.trim();
  if (!topic) {
    throw new Error("findDecision: topic must be non-empty");
  }
  if (!opts.repoId.trim()) {
    throw new Error("findDecision: repoId must be non-empty");
  }

  const limit = opts.limit ?? 8;
  const scoreThreshold = opts.scoreThreshold ?? 0.45;

  const deps: FindDecisionDeps = opts.deps ?? {
    search: (args) =>
      searchSimilarDecisions(opts.qdrant, {
        repoId: args.repoId,
        vector: args.vector,
        limit: args.limit,
        scoreThreshold: args.scoreThreshold,
      }),
    getByIds: (ids) => getDecisionsByIds(opts.db, ids),
  };

  const [vector] = await opts.embed([topic]);
  if (!vector || vector.length === 0) {
    throw new Error("findDecision: embedding provider returned an empty vector");
  }

  const hits = await deps.search({
    repoId: opts.repoId,
    vector,
    limit,
    scoreThreshold,
  });

  if (hits.length === 0) {
    return FindDecisionOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const includeHistory = opts.includeHistory ?? false;
  const results: FindDecisionOutput["results"] = [];

  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    if (!includeHistory && row.supersededBy) continue;

    // Citation is mandatory — skip corrupt rows rather than failing the whole tool.
    const sourceUrl = row.sourceUrl?.trim() ?? "";
    if (!isHttpUrl(sourceUrl)) continue;

    results.push({
      topic: row.topic,
      summary: row.summary,
      alternativesConsidered: row.alternativesConsidered ?? [],
      sourceUrl,
      confidence: row.confidence,
      superseded: Boolean(row.supersededBy),
    });
  }

  return FindDecisionOutputSchema.parse({ results });
}
