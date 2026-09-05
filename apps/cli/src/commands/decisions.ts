import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import pc from "picocolors";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { classifyAlternativesQuality } from "@codeoracle/core-domain";
import {
  clearRepoDecisions,
  closeDb,
  createDb,
  decisions,
  githubSources,
  listDecisionsForReview,
  listFailedExtractJobs,
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

    const emptyAlts = rows.filter((r) => r.alternativesConsidered.length === 0).length;
    console.log(
      pc.bold(`Decisions for ${repo.githubFullName ?? repo.localClonePath ?? repoId}`) +
        pc.dim(` (${rows.length} shown, newest first)`) +
        pc.dim(` · empty alternatives: ${emptyAlts}/${rows.length}\n`),
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



/**
 * Q3 ops audit: bucket stored decisions vs source text.
 * filled | inconsistent | true_empty — no invent / no fill-rate hacks.
 */
export async function runDecisionsAltsAudit(
  repoId: string,
  opts: { limit?: number; show?: boolean } = {},
): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 200;

  try {
    const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
    if (!repo) {
      console.error(pc.red(`Repo not found: ${repoId}`));
      process.exitCode = 1;
      return;
    }

    const rows = await db
      .select({
        id: decisions.id,
        topic: decisions.topic,
        summary: decisions.summary,
        alternativesConsidered: decisions.alternativesConsidered,
        sourceUrl: decisions.sourceUrl,
        confidence: decisions.confidence,
        sourceTitle: githubSources.title,
        sourceBody: githubSources.body,
      })
      .from(decisions)
      .leftJoin(githubSources, eq(decisions.sourceUrl, githubSources.sourceUrl))
      .where(eq(decisions.repoId, repoId))
      .orderBy(desc(decisions.decidedAt))
      .limit(limit);

    if (rows.length === 0) {
      console.log(pc.yellow(`No decisions for ${repo.githubFullName ?? repoId}.`));
      return;
    }

    const buckets = {
      filled: [] as typeof rows,
      inconsistent: [] as typeof rows,
      true_empty: [] as typeof rows,
    };

    for (const row of rows) {
      const bucket = classifyAlternativesQuality({
        summary: row.summary,
        alternativesConsidered: row.alternativesConsidered ?? [],
        sourceTitle: row.sourceTitle ?? undefined,
        sourceBody: row.sourceBody ?? undefined,
      });
      buckets[bucket].push(row);
    }

    const total = rows.length;
    const pct = (n: number) => `${((100 * n) / total).toFixed(1)}%`;

    console.log(
      pc.bold(`Alternatives audit for ${repo.githubFullName ?? repoId}`) +
        pc.dim(` (${total} decisions)\n`),
    );
    console.log(
      `  filled         ${buckets.filled.length.toString().padStart(4)}  ${pct(buckets.filled.length)}  — has alternatives`,
    );
    console.log(
      `  inconsistent   ${buckets.inconsistent.length.toString().padStart(4)}  ${pct(buckets.inconsistent.length)}  — empty alts but contrast in source/summary`,
    );
    console.log(
      `  true_empty     ${buckets.true_empty.length.toString().padStart(4)}  ${pct(buckets.true_empty.length)}  — empty alts, no contrast cue (honest or weak source)`,
    );
    console.log("");
    console.log(
      pc.dim(
        "Exit target for Q3 gate: inconsistent → ~0 on new extracts. true_empty is allowed.",
      ),
    );

    if (opts.show && buckets.inconsistent.length > 0) {
      console.log(pc.bold("\nInconsistent samples:"));
      for (const row of buckets.inconsistent.slice(0, 20)) {
        console.log(pc.red(`• ${row.topic}`) + pc.dim(` conf=${row.confidence.toFixed(2)}`));
        console.log(pc.dim(`  ${row.summary.slice(0, 160)}`));
        console.log(pc.underline(row.sourceUrl));
      }
    }

    if (buckets.inconsistent.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}

/** List recent failed extract_decisions jobs (G3.21). */
export async function runDecisionsFailures(repoId: string): Promise<void> {
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

    const rows = await listFailedExtractJobs(db, repoId, 50);
    if (rows.length === 0) {
      console.log(pc.green(`No failed extract jobs for ${repo.githubFullName ?? repoId}.`));
      return;
    }

    console.log(
      pc.bold(`Failed extract jobs for ${repo.githubFullName ?? repoId}`) +
        pc.dim(` (${rows.length})\n`),
    );
    for (const row of rows) {
      console.log(pc.red(`• ${row.createdAt.toISOString()}`) + pc.dim(` id=${row.id}`));
      console.log(pc.dim(`  source=${row.dedupeKey ?? "(none)"} · tokens=${row.tokensUsed}`));
      console.log(`  ${row.errorMessage ?? "(no error_message stored)"}`);
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
