import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import pc from "picocolors";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import {
  clearRepoDecisions,
  closeDb,
  createDb,
  listDecisionsForReview,
  repos,
} from "@codeoracle/db";
import { createQueue, createRedisConnection } from "@codeoracle/queue";
import { createQdrantClient, deleteRepoDecisionVectors } from "@codeoracle/retrieval";
import { queueExtractDecisionsForRepo } from "@codeoracle/worker";

const projectRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

export async function runDecisionsReview(repoId: string): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  try {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo) {
      console.error(pc.red(`Repo not found: ${repoId}`));
      process.exitCode = 1;
      return;
    }

    const rows = await listDecisionsForReview(db, repoId, 100);
    if (rows.length === 0) {
      console.log(
        pc.yellow(`No decisions stored for ${repo.githubFullName ?? repo.localClonePath ?? repoId}.`),
      );
      console.log(
        pc.dim("Run a full index first — extract_decisions jobs queue when indexing completes."),
      );
      return;
    }

    console.log(
      pc.bold(`Decisions for ${repo.githubFullName ?? repo.localClonePath ?? repoId}`) +
        pc.dim(` (${rows.length} shown, newest first)\n`),
    );

    for (const [idx, row] of rows.entries()) {
      const status = row.supersededBy ? pc.strikethrough("superseded") : pc.green("active");
      console.log(pc.cyan(`${idx + 1}. ${row.topic}`) + `  ${pc.dim(`[${status}]`)}`);
      console.log(`   ${row.summary}`);
      if (row.alternativesConsidered.length > 0) {
        console.log(pc.dim(`   Alternatives: ${row.alternativesConsidered.join("; ")}`));
      }
      console.log(
        pc.dim(
          `   confidence=${row.confidence.toFixed(2)} · decided=${row.decidedAt.toISOString()} · model=${row.extractionModelId}`,
        ),
      );
      console.log(pc.underline(row.sourceUrl));
      if (row.touchedPaths.length > 0) {
        console.log(pc.dim(`   paths: ${row.touchedPaths.join(", ")}`));
      }
      console.log("");
    }
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}

/** Clear stored decisions (optional) and queue extract jobs without a full re-index. */
export async function runDecisionsExtract(
  repoId: string,
  opts: { clear?: boolean; limit?: number } = {},
): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(connection);

  try {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo) {
      console.error(pc.red(`Repo not found: ${repoId}`));
      process.exitCode = 1;
      return;
    }
    if (repo.indexStatus !== "ready") {
      console.error(
        pc.red(`Repo index_status=${repo.indexStatus} — finish indexing before extract.`),
      );
      process.exitCode = 1;
      return;
    }

    if (opts.clear) {
      await clearRepoDecisions(db, repoId);
      const qdrant = createQdrantClient(env.QDRANT_URL);
      await deleteRepoDecisionVectors(qdrant, repoId);
      console.log(pc.dim("Cleared existing decisions (Postgres + Qdrant)."));
    }

    const limit =
      opts.limit !== undefined && opts.limit > 0
        ? opts.limit
        : env.EXTRACT_QUEUE_LIMIT > 0
          ? env.EXTRACT_QUEUE_LIMIT
          : undefined;

    const { queued, skippedTrivial, skippedCommitCoveredByPr } = await queueExtractDecisionsForRepo({
      db,
      queue,
      repoId,
      limit,
    });
    console.log(
      pc.bold(`Queued ${queued} extract jobs`) +
        pc.dim(` for ${repo.githubFullName}`) +
        (limit ? pc.dim(` (limit=${limit})`) : "") +
        (skippedTrivial > 0 ? pc.dim(` (skipped ${skippedTrivial} trivial)`) : "") +
        (skippedCommitCoveredByPr > 0
          ? pc.dim(` (skipped ${skippedCommitCoveredByPr} commits covered by PR)`)
          : ""),
    );
  } finally {
    await queue.close();
    await connection.quit();
    await closeDb(env.DATABASE_URL);
  }
}
