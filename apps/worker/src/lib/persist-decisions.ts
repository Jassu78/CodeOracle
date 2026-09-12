import type { DecisionExtractionResult } from "@codeoracle/contracts";
import type { EmbeddingProviderPort } from "@codeoracle/gateway";
import {
  getDecisionsByIds,
  persistOneDecision,
  type Database,
} from "@codeoracle/db";
import {
  createQdrantClient,
  decisionEmbedText,
  ensureDecisionsCollection,
  searchSimilarDecisions,
  upsertDecisionVectors,
} from "@codeoracle/retrieval";

type QdrantClient = ReturnType<typeof createQdrantClient>;

/** Drop extractions below this without failing the job (PRD Stage 3 gate). */
export const MIN_EXTRACTION_CONFIDENCE = 0.5;

/** Cosine similarity threshold for `superseded_by` linking (D3.4). */
export const SUPERSEDE_SIMILARITY_THRESHOLD = 0.75;

export async function persistExtractedDecisions(opts: {
  db: Database;
  qdrant: QdrantClient;
  gateway: EmbeddingProviderPort;
  repoId: string;
  sourceType: "pr" | "commit";
  sourceUrl: string;
  sourceSha: string;
  decidedAt: Date;
  extractionModelId: string;
  embeddingModelId: string;
  extracted: DecisionExtractionResult[];
}): Promise<{ inserted: number; supersededLinks: number }> {
  let inserted = 0;
  let supersededLinks = 0;

  for (const item of opts.extracted) {
    const embedText = decisionEmbedText(item.topic, item.summary, item.alternativesConsidered);
    const embedResult = await opts.gateway.embed([embedText]);
    const vector = embedResult.vectors[0];
    if (!vector?.length) throw new Error("Embedding provider returned empty vector for decision");

    await ensureDecisionsCollection(opts.qdrant, vector.length);

    const matches = await searchSimilarDecisions(opts.qdrant, {
      repoId: opts.repoId,
      vector,
      scoreThreshold: SUPERSEDE_SIMILARITY_THRESHOLD,
      denseOnly: true,
    });

    const matchRows = await getDecisionsByIds(
      opts.db,
      matches.map((m) => m.id),
    );
    const matchById = new Map(matchRows.map((row) => [row.id, row]));

    let bestMatch: { id: string; score: number; decidedAt: Date } | undefined;
    for (const match of matches) {
      const row = matchById.get(match.id);
      if (!row || row.supersededBy) continue;
      // P1-A: never link PR/commit archaeology to/from deterministic doc decisions.
      if (row.sourceType === "doc") continue;
      // Bind supersede to dense evidence only (never RRF).
      if (match.evidenceScore < SUPERSEDE_SIMILARITY_THRESHOLD) continue;
      if (!bestMatch || match.evidenceScore > bestMatch.score) {
        bestMatch = { id: row.id, score: match.evidenceScore, decidedAt: row.decidedAt };
      }
    }

    let supersededBy: string | null = null;
    const supersedesIds: string[] = [];

    if (bestMatch) {
      if (opts.decidedAt > bestMatch.decidedAt) {
        supersedesIds.push(bestMatch.id);
      } else {
        supersededBy = bestMatch.id;
      }
    }

    const { id, supersededLinks: linked } = await persistOneDecision(opts.db, {
      repoId: opts.repoId,
      sourceType: opts.sourceType,
      sourceUrl: opts.sourceUrl,
      sourceSha: opts.sourceSha,
      decidedAt: opts.decidedAt,
      extractionModelId: opts.extractionModelId,
      embeddingModelId: opts.embeddingModelId,
      extracted: item,
      supersededBy,
      supersedesIds,
    });

    await upsertDecisionVectors(opts.qdrant, [
      {
        id,
        vector,
        sparseText: embedText,
        payload: {
          repo_id: opts.repoId,
          decision_id: id,
          topic: item.topic,
          embedding_model_id: opts.embeddingModelId,
          source_type: opts.sourceType,
        },
      },
    ]);

    inserted += 1;
    supersededLinks += linked;
  }

  return { inserted, supersededLinks };
}
