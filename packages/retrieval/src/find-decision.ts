import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  FindDecisionOutputSchema,
  type FindDecisionOutput,
} from "@codeoracle/contracts";
import {
  DECISION_RELATIVE_SCORE_FLOOR,
  applyRelativeScoreFloor,
  decisionSearchFetchLimit,
} from "@codeoracle/core-domain";
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
  /**
   * Max results returned after relative floor (display limit). Default 3.
   * Qdrant fetch is wider (`decisionSearchFetchLimit`) so drops + floor can still fill.
   */
  limit?: number;
  /**
   * Cosine score floor for topic search fetch. Looser than supersede (~0.75):
   * query phrasing rarely matches stored topic embeddings that tightly.
   * Precision vs the top hit is enforced by `relativeFloor` (Q2).
   */
  scoreThreshold?: number;
  /**
   * Keep hydrated hits with score >= topScore * relativeFloor.
   * Default 0.85 — live-tuned so HMAC bleed drops while hybrid near-ties stay.
   */
  relativeFloor?: number;
  /** Test seam — production callers omit this. */
  deps?: FindDecisionDeps;
};

type ScoredDecision = FindDecisionOutput["results"][number] & { score: number };

/**
 * Semantic decision lookup for MCP `find_decision`.
 * Embed → Qdrant (repo-scoped) → Postgres hydrate → citation filter →
 * relative score floor vs top hit → display cap → Zod.
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

  const displayLimit = opts.limit ?? 3;
  const fetchLimit = decisionSearchFetchLimit(displayLimit);
  const scoreThreshold = opts.scoreThreshold ?? 0.45;
  const relativeFloor = opts.relativeFloor ?? DECISION_RELATIVE_SCORE_FLOOR;

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
    limit: fetchLimit,
    scoreThreshold,
  });

  if (hits.length === 0) {
    return FindDecisionOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const includeHistory = opts.includeHistory ?? false;
  const scored: ScoredDecision[] = [];

  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    if (!includeHistory && row.supersededBy) continue;

    // Citation is mandatory — skip corrupt rows rather than failing the whole tool.
    const sourceUrl = row.sourceUrl?.trim() ?? "";
    if (!isHttpUrl(sourceUrl)) continue;

    scored.push({
      topic: row.topic,
      summary: row.summary,
      alternativesConsidered: row.alternativesConsidered ?? [],
      sourceUrl,
      confidence: row.confidence,
      superseded: Boolean(row.supersededBy),
      score: hit.score,
    });
  }

  const kept = applyRelativeScoreFloor(scored, { relativeFloor, limit: displayLimit });
  const results = kept.map(({ score: _score, ...rest }) => rest);

  return FindDecisionOutputSchema.parse({ results });
}
