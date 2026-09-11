import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { chunkFile, hashContent } from "@codeoracle/chunker";
import type { Env } from "@codeoracle/config";
import {
  JOB_NAMES,
  type IncrementalReindexJobPayload,
} from "@codeoracle/contracts";
import {
  chunks,
  deleteChunksByFilePath,
  deleteChunksByIds,
  findJobHistoryByKey,
  finishJobHistory,
  listChunksByFilePath,
  repos,
  startJobHistory,
  type Database,
} from "@codeoracle/db";
import {
  classifyGithubCompareFiles,
  classifyNameStatusLines,
  planChunkSync,
  type FileChange,
} from "@codeoracle/core-domain";
import { bullJobId } from "@codeoracle/queue";
import {
  createQdrantClient,
  deleteChunkVectorsByIds,
} from "@codeoracle/retrieval";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { cloneGithubRepo, ensureCloneDir } from "../crawler/github-clone.js";
import { assertIndexedLocalClonePath } from "../lib/assert-indexed-local-clone-path.js";
import {
  buildIgnoreMatcher,
  isDeniedOrBinary,
  readRepoFile,
} from "../crawler/walk-files.js";
import { recordDeferredPush } from "../lib/deferred-push.js";
import { beginIndexRun, clearIndexRun, markFileComplete } from "../lib/index-progress.js";
import { queueExtractDecisionsForSourceIds } from "../lib/queue-extraction-jobs.js";
import { syncMergedPrsAtCommit } from "../lib/sync-merged-pr-at-commit.js";
import { finalizeIndexIfComplete } from "./full-index.js";

const execFileCb = promisify(execFile);

const ZERO_SHA = "0000000000000000000000000000000000000000";
/** Git empty tree — last-resort base when branch-create before=zeros and merge-base fails. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d3527f25fb579";

async function execFileAsync(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  if (opts.input === undefined) {
    const result = await execFileCb(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      encoding: "utf8",
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr ?? "") };
  }
  // util.promisify(execFile) does not accept `input`; use callback form with stdin.
  const { spawn } = await import("node:child_process");
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${file} ${args.join(" ")} exited ${code}: ${stderr}`));
    });
    child.stdin.end(opts.input);
  });
}

export type IncrementalReindexResult = {
  skipped?: boolean;
  reason?: string;
  deletedFiles: number;
  rechunkedFiles: number;
  embedJobsQueued: number;
  unchangedFiles: number;
  mergedPrExtractQueued: number;
};

/**
 * Incremental reindex — never wipes the whole repo.
 * Compare before...after → delete / hash-diff rechunk → embed only new hashes.
 */
export async function runIncrementalReindex(opts: {
  env: Env;
  redis: IORedis;
  queue: Queue;
  db: Database;
  payload: IncrementalReindexJobPayload;
}): Promise<IncrementalReindexResult> {
  const { repoId, beforeSha, afterSha } = opts.payload;
  const started = Date.now();

  const prior = await findJobHistoryByKey(opts.db, {
    repoId,
    jobType: JOB_NAMES.INCREMENTAL_REINDEX,
    dedupeKey: afterSha,
  });
  if (prior?.status === "done") {
    return {
      skipped: true,
      reason: "already processed afterSha",
      deletedFiles: 0,
      rechunkedFiles: 0,
      embedJobsQueued: 0,
      unchangedFiles: 0,
      mergedPrExtractQueued: 0,
    };
  }

  const [repo] = await opts.db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  if (!repo) {
    throw new Error(`Repo ${repoId} not found`);
  }

  // Do not mark job_history done when deferring — that would permanently skip this afterSha.
  // Coalesce into Redis; flushDeferredPushToQueue runs when index returns to ready.
  if (repo.indexStatus === "indexing") {
    const deferred = await recordDeferredPush(opts.redis, repoId, { beforeSha, afterSha });
    return {
      skipped: true,
      reason: `index in progress — deferred push ${deferred.baseSha.slice(0, 7)}..${deferred.tipSha.slice(0, 7)}`,
      deletedFiles: 0,
      rechunkedFiles: 0,
      embedJobsQueued: 0,
      unchangedFiles: 0,
      mergedPrExtractQueued: 0,
    };
  }
  if (!repo.embeddingModelId) {
    throw new Error(`Repo ${repoId} missing embeddingModelId — run full index first`);
  }

  const jobHistoryId = await startJobHistory(opts.db, {
    repoId,
    jobType: JOB_NAMES.INCREMENTAL_REINDEX,
    dedupeKey: afterSha,
  });

  const qdrant = createQdrantClient(opts.env.QDRANT_URL);
  const indexRunId = randomUUID();

  try {
    await opts.db.update(repos).set({ indexStatus: "indexing" }).where(eq(repos.id, repoId));

    let repoRoot: string;
    if (repo.localClonePath) {
      repoRoot = assertIndexedLocalClonePath(opts.env, repo.localClonePath);
    } else {
      if (!opts.env.GITHUB_PAT) throw new Error("GITHUB_PAT required for GitHub incremental reindex");
      await ensureCloneDir(opts.env.CODEORACLE_CLONE_DIR, opts.env.CLONE_MAX_REPOS);
      repoRoot = await cloneGithubRepo({
        cloneRoot: opts.env.CODEORACLE_CLONE_DIR,
        githubFullName: repo.githubFullName,
        branch: repo.defaultBranch,
        pat: opts.env.GITHUB_PAT,
        historyDepth: opts.env.CLONE_HISTORY_DEPTH,
      });
      try {
        await execFileAsync("git", ["fetch", "origin", afterSha, "--depth", "1"], {
          cwd: repoRoot,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      } catch {
        // Compare API still lists paths; working tree may already be at tip.
      }
      try {
        await execFileAsync("git", ["checkout", "--detach", afterSha], {
          cwd: repoRoot,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      } catch {
        await execFileAsync("git", ["reset", "--hard", `origin/${repo.defaultBranch}`], {
          cwd: repoRoot,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        });
      }
    }

    const changes = await resolveFileChanges({
      env: opts.env,
      repoRoot,
      githubFullName: repo.githubFullName,
      defaultBranch: repo.defaultBranch,
      beforeSha,
      afterSha,
      isLocal: Boolean(repo.localClonePath),
    });

    const ig = buildIgnoreMatcher();
    const filtered = changes.filter((c) => !isDeniedOrBinary(c.path, ig));

    const deleted = filtered.filter((c) => c.kind === "deleted");
    const upserts = filtered.filter((c) => c.kind === "added" || c.kind === "modified");

    for (const file of deleted) {
      const removed = await deleteChunksByFilePath(opts.db, repoId, file.path);
      await deleteChunkVectorsByIds(qdrant, removed.qdrantPointIds);
    }

    await beginIndexRun(opts.redis, repoId, upserts.length, "incremental");

    let embedJobsQueued = 0;
    let unchangedFiles = 0;
    let rechunkedFiles = 0;
    const mergedPrExtractQueued = await queueMergedPrExtractIfAny({
      env: opts.env,
      db: opts.db,
      queue: opts.queue,
      repoId,
      githubFullName: repo.githubFullName,
      afterSha,
      isLocal: Boolean(repo.localClonePath),
    });

    if (upserts.length === 0) {
      await finalizeIndexIfComplete({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        repoId,
        queue: opts.queue,
      });
      await finishJobHistory(opts.db, jobHistoryId, {
        status: "done",
        latencyMs: Date.now() - started,
      });
      return {
        deletedFiles: deleted.length,
        rechunkedFiles: 0,
        embedJobsQueued: 0,
        unchangedFiles: 0,
        mergedPrExtractQueued,
      };
    }

    for (const file of upserts) {
      const existing = await listChunksByFilePath(opts.db, repoId, file.path);
      let source: string;
      try {
        source = await readRepoFile(repoRoot, file.path);
      } catch {
        const removed = await deleteChunksByFilePath(opts.db, repoId, file.path);
        await deleteChunkVectorsByIds(qdrant, removed.qdrantPointIds);
        unchangedFiles += 1;
        await markFileComplete(opts.redis, repoId);
        continue;
      }

      if (source.includes("\0")) {
        const removed = await deleteChunksByFilePath(opts.db, repoId, file.path);
        await deleteChunkVectorsByIds(qdrant, removed.qdrantPointIds);
        unchangedFiles += 1;
        await markFileComplete(opts.redis, repoId);
        continue;
      }

      const incoming = chunkFile(file.path, source).map((raw) => ({
        ...raw,
        contentHash: hashContent(raw.content),
      }));

      const plan = planChunkSync(
        existing.map((r) => ({
          id: r.id,
          contentHash: r.contentHash,
          qdrantPointId: r.qdrantPointId,
        })),
        incoming,
      );

      if (plan.deleteIds.length > 0) {
        await deleteChunksByIds(opts.db, plan.deleteIds);
        await deleteChunkVectorsByIds(qdrant, plan.deleteQdrantIds);
      }

      if (plan.toInsert.length > 0) {
        const chunkIds: string[] = [];
        const rows = plan.toInsert.map((raw) => {
          const chunkId = randomUUID();
          chunkIds.push(chunkId);
          return {
            id: chunkId,
            repoId,
            filePath: raw.filePath,
            symbolName: raw.symbolName,
            parentSymbol: raw.parentSymbol,
            language: raw.language,
            byteStart: raw.byteStart,
            byteEnd: raw.byteEnd,
            content: raw.content,
            contentHash: raw.contentHash,
            embeddingModelId: repo.embeddingModelId!,
            qdrantPointId: chunkId,
            lastIndexedSha: afterSha,
          };
        });
        await opts.db.insert(chunks).values(rows);

        await opts.queue.add(
          JOB_NAMES.EMBED_CHUNKS,
          {
            repoId,
            chunkIds,
            embeddingModelId: repo.embeddingModelId!,
            filePath: file.path,
            sha: afterSha,
            indexRunId,
          },
          {
            jobId: bullJobId("embed_chunks", repoId, indexRunId, file.path),
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
          },
        );
        embedJobsQueued += 1;
        rechunkedFiles += 1;
      } else {
        unchangedFiles += 1;
        await markFileComplete(opts.redis, repoId);
        await finalizeIndexIfComplete({
          env: opts.env,
          redis: opts.redis,
          db: opts.db,
          repoId,
          queue: opts.queue,
        });
      }
    }

    if (embedJobsQueued === 0) {
      await finalizeIndexIfComplete({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        repoId,
        queue: opts.queue,
      });
    }

    await finishJobHistory(opts.db, jobHistoryId, {
      status: "done",
      latencyMs: Date.now() - started,
    });

    return {
      deletedFiles: deleted.length,
      rechunkedFiles,
      embedJobsQueued,
      unchangedFiles,
      mergedPrExtractQueued,
    };
  } catch (err) {
    await opts.db.update(repos).set({ indexStatus: "error" }).where(eq(repos.id, repoId));
    await clearIndexRun(opts.redis, repoId);
    const message = err instanceof Error ? err.message : String(err);
    await finishJobHistory(opts.db, jobHistoryId, {
      status: "error",
      latencyMs: Date.now() - started,
      errorMessage: message.slice(0, 2000),
    });
    throw err;
  }
}

/**
 * Branch-create webhooks send before=zeros. Diffing the empty tree often fails
 * (object missing in shallow clones) and GitHub compare rejects that base.
 * Prefer default-branch…after (branch delta); else materialize empty tree locally.
 */
export async function resolveIncrementalCompareBase(opts: {
  repoRoot: string;
  defaultBranch: string;
  beforeSha: string;
  afterSha: string;
}): Promise<string> {
  if (opts.beforeSha !== ZERO_SHA) return opts.beforeSha;

  for (const tip of [`origin/${opts.defaultBranch}`, opts.defaultBranch]) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["merge-base", tip, opts.afterSha],
        { cwd: opts.repoRoot },
      );
      const base = stdout.trim();
      if (base) return base;
    } catch {
      // try next tip
    }
  }

  return ensureEmptyTreeObject(opts.repoRoot);
}

async function ensureEmptyTreeObject(repoRoot: string): Promise<string> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `${EMPTY_TREE}^{tree}`], {
      cwd: repoRoot,
    });
    return EMPTY_TREE;
  } catch {
    // Materialize an empty tree object (oid is stable across git versions when stdin is empty).
    const { stdout } = await execFileAsync("git", ["hash-object", "-t", "tree", "--stdin"], {
      cwd: repoRoot,
      input: "",
    });
    const oid = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(oid)) {
      throw new Error(`git hash-object empty tree produced invalid oid: ${oid}`);
    }
    return oid;
  }
}

async function resolveFileChanges(opts: {
  env: Env;
  repoRoot: string;
  githubFullName: string;
  defaultBranch: string;
  beforeSha: string;
  afterSha: string;
  isLocal: boolean;
}): Promise<FileChange[]> {
  if (!opts.isLocal && opts.env.GITHUB_PAT) {
    try {
      const [owner, name] = opts.githubFullName.split("/");
      if (owner && name) {
        const octokit = new Octokit({ auth: opts.env.GITHUB_PAT });
        // Branch create: compare against default branch tip, not the empty tree.
        const base =
          opts.beforeSha === ZERO_SHA ? opts.defaultBranch : opts.beforeSha;
        const { data } = await octokit.rest.repos.compareCommits({
          owner,
          repo: name,
          base,
          head: opts.afterSha,
        });
        return classifyGithubCompareFiles(
          (data.files ?? []).map((f) => ({
            filename: f.filename!,
            status: f.status ?? "modified",
            previous_filename: f.previous_filename ?? null,
          })),
        );
      }
    } catch {
      // Fall through to local git diff.
    }
  }

  const base = await resolveIncrementalCompareBase({
    repoRoot: opts.repoRoot,
    defaultBranch: opts.defaultBranch,
    beforeSha: opts.beforeSha,
    afterSha: opts.afterSha,
  });
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-status", "-z", base, opts.afterSha],
    { cwd: opts.repoRoot },
  );
  const tokens = stdout.split("\0").filter(Boolean);
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      lines.push(`${status}\t${tokens[i + 1]}\t${tokens[i + 2]}`);
      i += 3;
    } else {
      lines.push(`${status}\t${tokens[i + 1]}`);
      i += 2;
    }
  }
  return classifyNameStatusLines(lines);
}

async function queueMergedPrExtractIfAny(opts: {
  env: Env;
  db: Database;
  queue: Queue;
  repoId: string;
  githubFullName: string;
  afterSha: string;
  isLocal: boolean;
}): Promise<number> {
  if (opts.isLocal || !opts.env.GITHUB_PAT || opts.githubFullName.startsWith("local/")) {
    return 0;
  }

  const synced = await syncMergedPrsAtCommit({
    db: opts.db,
    repoId: opts.repoId,
    githubFullName: opts.githubFullName,
    pat: opts.env.GITHUB_PAT,
    afterSha: opts.afterSha,
  });
  if (synced.length === 0) return 0;

  const { queued } = await queueExtractDecisionsForSourceIds({
    queue: opts.queue,
    repoId: opts.repoId,
    githubSourceIds: synced.map((s) => s.githubSourceId),
  });
  return queued;
}
