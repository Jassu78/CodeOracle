import type { EmbeddingProviderPort } from "@codeoracle/gateway";
import {
  persistOneDecision,
  type Database,
} from "@codeoracle/db";
import {
  createQdrantClient,
  decisionEmbedText,
  ensureDecisionsCollection,
  upsertDecisionVectors,
} from "@codeoracle/retrieval";
import {
  DOC_INDEX_EXTRACTION_MODEL_ID,
  type DocDecisionDraft,
  githubBlobCitationUrl,
} from "./build-doc-decisions.js";

type QdrantClient = ReturnType<typeof createQdrantClient>;

/**
 * Persist deterministic doc Decisions with **no supersede linking**
 * (doc must not supersede or be superseded by PR/commit archaeology in v1).
 */
export async function persistDocDecisions(opts: {
  db: Database;
  qdrant: QdrantClient;
  gateway: EmbeddingProviderPort;
  repoId: string;
  githubHttpsBase: string;
  sourceSha: string;
  decidedAt: Date;
  embeddingModelId: string;
  drafts: DocDecisionDraft[];
}): Promise<{ inserted: number }> {
  let inserted = 0;

  for (const draft of opts.drafts) {
    const filePath = draft.touchedPaths[0];
    if (!filePath) continue;

    const sourceUrl = githubBlobCitationUrl({
      githubHttpsBase: opts.githubHttpsBase,
      sha: opts.sourceSha,
      filePath,
      startLine: draft.startLine,
    });

    const embedText = decisionEmbedText(
      draft.topic,
      draft.summary,
      draft.alternativesConsidered,
    );
    const embedResult = await opts.gateway.embed([embedText]);
    const vector = embedResult.vectors[0];
    if (!vector?.length) {
      throw new Error("Embedding provider returned empty vector for doc decision");
    }

    await ensureDecisionsCollection(opts.qdrant, vector.length);

    const { id } = await persistOneDecision(opts.db, {
      repoId: opts.repoId,
      sourceType: "doc",
      sourceUrl,
      sourceSha: opts.sourceSha,
      decidedAt: opts.decidedAt,
      extractionModelId: DOC_INDEX_EXTRACTION_MODEL_ID,
      embeddingModelId: opts.embeddingModelId,
      extracted: {
        topic: draft.topic,
        summary: draft.summary,
        alternativesConsidered: draft.alternativesConsidered,
        confidence: draft.confidence,
        touchedPaths: draft.touchedPaths,
      },
      supersededBy: null,
      supersedesIds: [],
    });

    await upsertDecisionVectors(opts.qdrant, [
      {
        id,
        vector,
        sparseText: embedText,
        payload: {
          repo_id: opts.repoId,
          decision_id: id,
          topic: draft.topic,
          embedding_model_id: opts.embeddingModelId,
          source_type: "doc",
        },
      },
    ]);

    inserted += 1;
  }

  return { inserted };
}
