import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Env } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import {
  clearRepoChunks,
  finishJobHistory,
  repos,
  startJobHistory,
  type Database,
} from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
import { bullJobId } from "@codeoracle/queue";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { createQdrantClient, deleteRepoChunkVectors } from "@codeoracle/retrieval";
import { cloneGithubRepo, ensureCloneDir } from "../crawler/github-clone.js";
import { crawlGithubHistory, crawlLocalGitHistory } from "../crawler/github-history.js";
import { listSourceFiles, resolveRepoHeadSha } from "../crawler/walk-files.js";
import { beginIndexRun, clearIndexRun, getIndexRunStats, getPendingFileCount } from "../lib/index-progress.js";

export async function runFullIndexSetup(opts: {
  env: Env;
  providers: ProvidersConfig;
  redis: IORedis;
  queue: Queue;
  db: Database;
  repoId: string;
}): Promise<{ filesQueued: number; headSha: string }> {
  const db = opts.db;
  const qdrant = createQdrantClient(opts.env.QDRANT_URL);
  const gateway = new ProviderRegistry(opts.providers, process.env);
  const started = Date.now();
  const jobHistoryId = await startJobHistory(db, {
    repoId: opts.repoId,
    jobType: JOB_NAMES.FULL_INDEX,
    afterSha: `full-index:${Date.now()}`,
  });

  const [repo] = await db.select().from(repos).where(eq(repos.id, opts.repoId)).limit(1);
  if (!repo) throw new Error(`Repo ${opts.repoId} not found`);

  await db.update(repos).set({ indexStatus: "indexing" }).where(eq(repos.id, opts.repoId));

  try {
    const embeddingModelId = gateway.primaryEmbeddingModelId();
    await db.update(repos).set({ embeddingModelId }).where(eq(repos.id, opts.repoId));

    await clearRepoChunks(db, opts.repoId);
    await deleteRepoChunkVectors(qdrant, opts.repoId);
    await clearIndexRun(opts.redis, opts.repoId);

    const isLocal = Boolean(repo.localClonePath);
    let repoRoot: string;

    if (isLocal) {
      repoRoot = repo.localClonePath!;
    } else {
      if (!opts.env.GITHUB_PAT) throw new Error("GITHUB_PAT required for GitHub repos");
      await ensureCloneDir(opts.env.CODEORACLE_CLONE_DIR, opts.env.CLONE_MAX_REPOS);
      repoRoot = await cloneGithubRepo({
        cloneRoot: opts.env.CODEORACLE_CLONE_DIR,
        githubFullName: repo.githubFullName,
        branch: repo.defaultBranch,
        pat: opts.env.GITHUB_PAT,
      });
    }

    if (isLocal) {
      await crawlLocalGitHistory({ db, repoId: opts.repoId, repoRoot });
    } else {
      await crawlGithubHistory({
        db,
        repoId: opts.repoId,
        githubFullName: repo.githubFullName,
        pat: opts.env.GITHUB_PAT!,
      });
    }

    const headSha = await resolveRepoHeadSha(repoRoot);
    const indexRunId = randomUUID();
    const files = await listSourceFiles(repoRoot);
    await beginIndexRun(opts.redis, opts.repoId, files.length);

    if (files.length === 0) {
      await db
        .update(repos)
        .set({ indexStatus: "ready", lastFullIndexAt: new Date() })
        .where(eq(repos.id, opts.repoId));
      await finishJobHistory(db, jobHistoryId, { status: "done", latencyMs: Date.now() - started });
      return { filesQueued: 0, headSha };
    }

    await opts.queue.addBulk(
      files.map((filePath) => ({
        name: JOB_NAMES.CHUNK_FILE,
        data: {
          repoId: opts.repoId,
          repoRoot,
          filePath,
          sha: headSha,
          indexRunId,
          embeddingModelId,
        },
        opts: {
          jobId: bullJobId("chunk_file", opts.repoId, indexRunId, filePath),
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      })),
    );

    await finishJobHistory(db, jobHistoryId, { status: "done", latencyMs: Date.now() - started });
    return { filesQueued: files.length, headSha };
  } catch (err) {
    await db.update(repos).set({ indexStatus: "error" }).where(eq(repos.id, opts.repoId));
    await finishJobHistory(db, jobHistoryId, { status: "error", latencyMs: Date.now() - started });
    await clearIndexRun(opts.redis, opts.repoId);
    throw err;
  }
}

export async function finalizeIndexIfComplete(opts: {
  env: Env;
  redis: IORedis;
  db: Database;
  repoId: string;
}): Promise<boolean> {
  const remaining = await getPendingFileCount(opts.redis, opts.repoId);
  if (remaining > 0) return false;

  const stats = await getIndexRunStats(opts.redis, opts.repoId);
  const allFilesFailed = stats.total > 0 && stats.failed >= stats.total;

  if (allFilesFailed) {
    await opts.db.update(repos).set({ indexStatus: "error" }).where(eq(repos.id, opts.repoId));
    console.error(
      `Index failed repo=${opts.repoId}: all ${stats.total} file jobs failed`,
    );
    await clearIndexRun(opts.redis, opts.repoId);
    return false;
  }

  if (stats.failed > 0) {
    console.warn(
      `Index completed with partial failures repo=${opts.repoId}: ${stats.failed}/${stats.total} files failed`,
    );
  }

  await opts.db
    .update(repos)
    .set({ indexStatus: "ready", lastFullIndexAt: new Date() })
    .where(eq(repos.id, opts.repoId));
  await clearIndexRun(opts.redis, opts.repoId);
  return true;
}

export async function markRepoIndexError(
  env: Env,
  repoId: string,
  redis: IORedis | undefined,
  db: Database,
): Promise<void> {
  await db.update(repos).set({ indexStatus: "error" }).where(eq(repos.id, repoId));
  if (redis) await clearIndexRun(redis, repoId);
}
