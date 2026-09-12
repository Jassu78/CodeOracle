import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { count, eq } from "drizzle-orm";
import { loadEnv, loadProjectEnv, loadProvidersConfig, assertLocalClonePathAllowed, parseAllowedRoots } from "@codeoracle/config";
import { JOB_NAMES } from "@codeoracle/contracts";
import {
  chunks,
  closeDb,
  createDb,
  getRepoById,
  githubSources,
  registerGithubRepo,
  registerLocalRepo,
} from "@codeoracle/db";
import { createQueue, createRedisConnection, bullJobId } from "@codeoracle/queue";
import { recoverStaleIndexRun } from "@codeoracle/worker";

const projectRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

export async function runRepoRegister(opts: {
  github?: string;
  branch?: string;
  localPath?: string;
  name?: string;
}): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  try {
    if (opts.localPath) {
      const name = opts.name ?? opts.localPath.split("/").pop() ?? "repo";
      const localClonePath = assertLocalClonePathAllowed(
        opts.localPath,
        parseAllowedRoots(env.CODEORACLE_ALLOWED_ROOTS),
        { nodeEnv: env.NODE_ENV },
      );
      const { repoId } = await registerLocalRepo(db, {
        name,
        localClonePath,
        branch: opts.branch,
      });
      p.log.success(`Registered local repo ${pc.cyan(`local/${name}`)} → ${repoId}`);
      return;
    }

    if (!opts.github) {
      p.log.error("Provide --github owner/repo or --local-path /path/to/mirror");
      process.exitCode = 1;
      return;
    }

    const { repoId } = await registerGithubRepo(db, {
      githubFullName: opts.github,
      branch: opts.branch ?? "main",
    });
    p.log.success(`Registered ${pc.cyan(opts.github)} → ${repoId}`);
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}

export async function runRepoIndex(repoId: string): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(connection);

  try {
    const repoRow = await getRepoById(db, repoId);
    if (!repoRow) {
      p.log.error(`Unknown repo id ${repoId}`);
      process.exitCode = 1;
      return;
    }

    const indexRunId = randomUUID();
    await queue.add(
      JOB_NAMES.FULL_INDEX,
      {
        repoId,
        githubFullName: repoRow.githubFullName,
        branch: repoRow.defaultBranch,
      },
      {
        jobId: bullJobId("full_index", repoId, indexRunId),
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      },
    );

    p.log.success(`Queued ${pc.cyan(JOB_NAMES.FULL_INDEX)} for ${repoRow.githubFullName}`);
    p.log.info("Start worker: pnpm worker");
  } finally {
    await queue.close();
    await connection.quit();
    await closeDb(env.DATABASE_URL);
  }
}

export async function runRepoRecover(repoId: string): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const connection = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(connection);

  try {
    const result = await recoverStaleIndexRun({
      env,
      providers,
      redis: connection,
      db,
      queue,
      repoId,
    });

    p.log.info(`Recover ${repoId}: ${result.action} — ${result.detail}`);
  } finally {
    await queue.close();
    await connection.quit();
    await closeDb(env.DATABASE_URL);
  }
}

export async function runRepoStatus(repoId: string): Promise<void> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  try {
    const row = await getRepoById(db, repoId);
    if (!row) {
      p.log.error(`Unknown repo id ${repoId}`);
      process.exitCode = 1;
      return;
    }

    const chunkCountRow = await db
      .select({ chunkTotal: count() })
      .from(chunks)
      .where(eq(chunks.repoId, repoId));
    const chunkTotal = Number(chunkCountRow[0]?.chunkTotal ?? 0);

    const sourceRows = await db
      .select({ sourceType: githubSources.sourceType, total: count() })
      .from(githubSources)
      .where(eq(githubSources.repoId, repoId))
      .groupBy(githubSources.sourceType);

    p.log.info(`${pc.cyan(row.githubFullName)}`);
    console.log(
      JSON.stringify(
        {
          repoId: row.id,
          githubFullName: row.githubFullName,
          defaultBranch: row.defaultBranch,
          indexStatus: row.indexStatus,
          embeddingModelId: row.embeddingModelId,
          localClonePath: row.localClonePath,
          lastFullIndexAt: row.lastFullIndexAt?.toISOString() ?? null,
          chunkCount: chunkTotal,
          githubSources: Object.fromEntries(sourceRows.map((r) => [r.sourceType, Number(r.total)])),
        },
        null,
        2,
      ),
    );
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}
