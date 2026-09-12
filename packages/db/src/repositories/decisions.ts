import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DecisionExtractionResult } from "@codeoracle/contracts";
import type { Database } from "../client.js";
import { decisions } from "../schema/decisions.js";

export type DecisionRow = typeof decisions.$inferSelect;

export async function clearRepoDecisions(db: Database, repoId: string): Promise<void> {
  await db.delete(decisions).where(eq(decisions.repoId, repoId));
}

/**
 * Delete doc-sourced decisions whose touched_paths include any of `paths`.
 * Returns deleted decision ids (for Qdrant cleanup).
 */
export async function deleteDocDecisionsTouchingPaths(
  db: Database,
  repoId: string,
  paths: string[],
): Promise<string[]> {
  const normalized = [...new Set(paths.map((p) => p.trim().replace(/\\/g, "/")).filter(Boolean))];
  if (normalized.length === 0) return [];

  const rows = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.repoId, repoId),
        eq(decisions.sourceType, "doc"),
        sql`EXISTS (
          SELECT 1
          FROM unnest(${decisions.touchedPaths}) AS tp
          WHERE tp = ANY(${normalized})
        )`,
      ),
    );

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  await db.delete(decisions).where(inArray(decisions.id, ids));
  return ids;
}

export async function listDecisionsForReview(
  db: Database,
  repoId: string,
  limit = 50,
): Promise<DecisionRow[]> {
  return db
    .select()
    .from(decisions)
    .where(eq(decisions.repoId, repoId))
    .orderBy(desc(decisions.decidedAt))
    .limit(limit);
}

export async function getDecisionsByIds(
  db: Database,
  ids: string[],
): Promise<DecisionRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(decisions).where(inArray(decisions.id, ids));
}

/**
 * Decisions whose `touched_paths` exactly match `filePath` or are a directory
 * prefix of it (e.g. touched `apps/api` matches `apps/api/src/main.ts`).
 */
export async function listDecisionsTouchingPath(
  db: Database,
  repoId: string,
  filePath: string,
): Promise<DecisionRow[]> {
  const path = filePath.trim();
  if (!path) return [];

  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.repoId, repoId),
        sql`EXISTS (
          SELECT 1
          FROM unnest(${decisions.touchedPaths}) AS tp
          WHERE tp = ${path}
             OR ${path} LIKE (tp || '/%')
        )`,
      ),
    )
    .orderBy(desc(decisions.decidedAt));
}

export async function markDecisionSuperseded(
  db: Database,
  decisionId: string,
  supersededById: string,
): Promise<void> {
  await db
    .update(decisions)
    .set({ supersededBy: supersededById })
    .where(and(eq(decisions.id, decisionId), isNull(decisions.supersededBy)));
}

export type PersistOneDecisionOpts = {
  repoId: string;
  sourceType: "pr" | "commit" | "doc";
  sourceUrl: string;
  sourceSha: string;
  decidedAt: Date;
  extractionModelId: string;
  embeddingModelId: string;
  extracted: DecisionExtractionResult;
  /** When set, this new decision is already superseded by an existing tip. */
  supersededBy?: string | null;
  /** Existing active decisions this new one replaces (decided before this source). */
  supersedesIds?: string[];
};

export type PersistOneDecisionResult = {
  id: string;
  supersededLinks: number;
};

/**
 * Insert one decision and link supersession edges. Caller owns embedding + Qdrant upsert.
 */
export async function persistOneDecision(
  db: Database,
  opts: PersistOneDecisionOpts,
): Promise<PersistOneDecisionResult> {
  const id = randomUUID();
  await db.insert(decisions).values({
    id,
    repoId: opts.repoId,
    topic: opts.extracted.topic,
    summary: opts.extracted.summary,
    alternativesConsidered: opts.extracted.alternativesConsidered,
    decidedAt: opts.decidedAt,
    sourceType: opts.sourceType,
    sourceUrl: opts.sourceUrl,
    sourceSha: opts.sourceSha,
    touchedPaths: opts.extracted.touchedPaths,
    confidence: opts.extracted.confidence,
    supersededBy: opts.supersededBy ?? null,
    embeddingModelId: opts.embeddingModelId,
    extractionModelId: opts.extractionModelId,
  });

  let supersededLinks = 0;
  for (const olderId of opts.supersedesIds ?? []) {
    await markDecisionSuperseded(db, olderId, id);
    supersededLinks += 1;
  }

  return { id, supersededLinks };
}
