import type { QdrantClient } from "@qdrant/js-client-rest";
import {
  FindDecisionOutputSchema,
  type FindDecisionOutput,
} from "@codeoracle/contracts";
import {
  DECISION_ABSOLUTE_SCORE_FLOOR,
  DECISION_RELATIVE_SCORE_FLOOR,
  applyRelativeScoreFloor,
  bestScore,
  decisionSearchFetchLimit,
} from "@codeoracle/core-domain";
import { getDecisionsByIds, type Database, type DecisionRow } from "@codeoracle/db";
import {
  searchSimilarDecisions,
  type DecisionSearchHit,
} from "./store/decisions.js";
import { isHttpUrl, type EmbedFn } from "./util.js";

export type { EmbedFn } from "./util.js";
export type { DecisionSearchHit } from "./store/decisions.js";

export type FindDecisionDeps = {
  search: (opts: {
    repoId: string;
    vector: number[];
    queryText: string;
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
  limit?: number;
  /**
   * Dense prefetch cosine floor (hybrid dense channel / legacy). Default 0.45.
   */
  scoreThreshold?: number;
  relativeFloor?: number;
  absoluteMinScore?: number;
  deps?: FindDecisionDeps;
};

type InternalHit = {
  id: string;
  topic: string;
  summary: string;
  alternativesConsidered: string[];
  sourceUrl: string;
  confidence: number;
  superseded: boolean;
  rrfScore: number;
  evidenceScore: number;
};

/**
 * Semantic decision lookup for MCP `find_decision`.
 * Embed topic → Qdrant hybrid (E4) → hydrate → citation filter →
 * absolute/relative floors on **dense evidence** → sort survivors by RRF → Zod.
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
  const absoluteMinScore = opts.absoluteMinScore ?? DECISION_ABSOLUTE_SCORE_FLOOR;

  const deps: FindDecisionDeps = opts.deps ?? {
    search: (args) =>
      searchSimilarDecisions(opts.qdrant, {
        repoId: args.repoId,
        vector: args.vector,
        queryText: args.queryText,
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
    queryText: topic,
    limit: fetchLimit,
    scoreThreshold,
  });

  if (hits.length === 0) {
    return FindDecisionOutputSchema.parse({ results: [] });
  }

  const rows = await deps.getByIds(hits.map((h) => h.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const includeHistory = opts.includeHistory ?? false;
  const scored: InternalHit[] = [];

  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (!row) continue;
    if (!includeHistory && row.supersededBy) continue;

    const sourceUrl = row.sourceUrl?.trim() ?? "";
    if (!isHttpUrl(sourceUrl)) continue;

    scored.push({
      id: row.id,
      topic: row.topic,
      summary: row.summary,
      alternativesConsidered: row.alternativesConsidered ?? [],
      sourceUrl,
      confidence: row.confidence,
      superseded: Boolean(row.supersededBy),
      rrfScore: hit.score,
      evidenceScore: hit.evidenceScore,
    });
  }

  // P0-B: if best dense evidence is too weak, empty (unsorted OK).
  if (bestScore(scored.map((h) => ({ score: h.evidenceScore }))) < absoluteMinScore) {
    return FindDecisionOutputSchema.parse({ results: [] });
  }

  // Relative floor on evidence vs max evidence.
  const byEvidenceDesc = [...scored].sort((a, b) => b.evidenceScore - a.evidenceScore);
  const evidenceAsScore = byEvidenceDesc.map((h) => ({
    ...h,
    score: h.evidenceScore,
  }));
  const afterRelative = applyRelativeScoreFloor(evidenceAsScore, {
    relativeFloor,
    limit: Number.POSITIVE_INFINITY,
  });

  // Display: RRF among survivors, then displayLimit.
  afterRelative.sort((a, b) => b.rrfScore - a.rrfScore);
  const results = afterRelative.slice(0, displayLimit).map(
    ({ id: _id, rrfScore, evidenceScore: _ev, score: _s, ...rest }) => ({
      ...rest,
      retrievalScore: rrfScore,
    }),
  );

  return FindDecisionOutputSchema.parse({ results });
}
