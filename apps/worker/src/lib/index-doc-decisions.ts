import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Env } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import {
  isDecisionShapedDocPath,
  mustRefuseSecretRetrieval,
} from "@codeoracle/core-domain";
import {
  deleteDocDecisionsTouchingPaths,
  type Database,
} from "@codeoracle/db";
import type { EmbeddingProviderPort } from "@codeoracle/gateway";
import { ProviderRegistry } from "@codeoracle/gateway";
import { logProviderUsage } from "@codeoracle/observability";
import {
  createQdrantClient,
  deleteDecisionVectorsByIds,
} from "@codeoracle/retrieval";
import type IORedis from "ioredis";
import { listSourceFiles } from "../crawler/walk-files.js";
import {
  DOC_INDEX_MAX_DECISIONS_PER_RUN,
  DOC_INDEX_MAX_FILE_BYTES,
  buildDocDecisionDrafts,
  type DocDecisionDraft,
} from "./build-doc-decisions.js";
import { resolveGithubHttpsBase } from "./citation-url.js";
import { persistDocDecisions } from "./persist-doc-decisions.js";

export type IndexDocDecisionsResult = {
  filesConsidered: number;
  inserted: number;
  skippedNoGithubBase: boolean;
  skippedSecret: number;
  skippedOversize: number;
  truncatedByCap: boolean;
};

type PreparedDocFile = {
  path: string;
  drafts: DocDecisionDraft[];
};

/**
 * Index decision-shaped markdown as Decision rows (sourceType=doc).
 * - Skips entirely when no https GitHub base (no local:// citations).
 * - Per-path replace: only delete PG/Qdrant for paths that will be reinserted.
 * - No PR/commit supersede linking (see persistDocDecisions).
 */
export async function indexDocDecisionsForRepo(opts: {
  env: Env;
  providers: ProvidersConfig;
  redis: IORedis;
  db: Database;
  repoId: string;
  sourceSha: string;
  repoRoot: string;
  /** When set, only these repo-relative paths (still filtered by class). */
  onlyPaths?: string[];
}): Promise<IndexDocDecisionsResult> {
  const empty: IndexDocDecisionsResult = {
    filesConsidered: 0,
    inserted: 0,
    skippedNoGithubBase: false,
    skippedSecret: 0,
    skippedOversize: 0,
    truncatedByCap: false,
  };

  const githubHttpsBase = await resolveGithubHttpsBase(opts.repoRoot);
  if (!githubHttpsBase) {
    console.warn(
      `[doc-decisions] repo=${opts.repoId}: no GitHub HTTPS base — skipping doc decision index`,
    );
    return { ...empty, skippedNoGithubBase: true };
  }

  let candidatePaths: string[];
  if (opts.onlyPaths && opts.onlyPaths.length > 0) {
    candidatePaths = [
      ...new Set(
        opts.onlyPaths
          .map((p) => p.replace(/\\/g, "/"))
          .filter((p) => isDecisionShapedDocPath(p)),
      ),
    ];
  } else {
    const all = await listSourceFiles(opts.repoRoot);
    candidatePaths = all.filter((p) => isDecisionShapedDocPath(p));
  }

  if (candidatePaths.length === 0) return empty;

  const gateway = new ProviderRegistry({
    config: opts.providers,
    env: process.env,
    onUsage: logProviderUsage,
    redis: opts.redis,
  });

  return runDocDecisionIndex({
    env: opts.env,
    db: opts.db,
    repoId: opts.repoId,
    sourceSha: opts.sourceSha,
    repoRoot: opts.repoRoot,
    githubHttpsBase,
    candidatePaths,
    gateway,
    embeddingModelId: gateway.primaryEmbeddingModelId(),
  });
}

/** Core path used by tests with a fake gateway. */
export async function runDocDecisionIndex(opts: {
  env: Env;
  db: Database;
  repoId: string;
  sourceSha: string;
  repoRoot: string;
  githubHttpsBase: string;
  candidatePaths: string[];
  gateway: EmbeddingProviderPort;
  embeddingModelId: string;
}): Promise<IndexDocDecisionsResult> {
  const result: IndexDocDecisionsResult = {
    filesConsidered: opts.candidatePaths.length,
    inserted: 0,
    skippedNoGithubBase: false,
    skippedSecret: 0,
    skippedOversize: 0,
    truncatedByCap: false,
  };

  const prepared: PreparedDocFile[] = [];
  let decisionBudget = DOC_INDEX_MAX_DECISIONS_PER_RUN;

  for (const relPath of opts.candidatePaths) {
    if (decisionBudget <= 0) {
      result.truncatedByCap = true;
      break;
    }

    if (mustRefuseSecretRetrieval(relPath)) {
      result.skippedSecret += 1;
      continue;
    }

    let raw: string;
    try {
      const buf = await readFile(join(opts.repoRoot, relPath));
      if (buf.byteLength > DOC_INDEX_MAX_FILE_BYTES) {
        result.skippedOversize += 1;
        continue;
      }
      raw = buf.toString("utf8");
    } catch {
      continue;
    }

    if (mustRefuseSecretRetrieval(relPath, raw)) {
      result.skippedSecret += 1;
      continue;
    }

    let drafts = buildDocDecisionDrafts(relPath, raw);
    if (drafts.length === 0) continue;
    if (drafts.length > decisionBudget) {
      drafts = drafts.slice(0, decisionBudget);
      result.truncatedByCap = true;
    }
    decisionBudget -= drafts.length;
    prepared.push({ path: relPath, drafts });
    if (result.truncatedByCap) break;
  }

  if (prepared.length === 0) return result;

  const replacePaths = prepared.map((p) => p.path);
  const deletedIds = await deleteDocDecisionsTouchingPaths(
    opts.db,
    opts.repoId,
    replacePaths,
  );
  const qdrant = createQdrantClient(opts.env.QDRANT_URL);
  if (deletedIds.length > 0) {
    await deleteDecisionVectorsByIds(qdrant, deletedIds);
  }

  const allDrafts = prepared.flatMap((p) => p.drafts);
  const { inserted } = await persistDocDecisions({
    db: opts.db,
    qdrant,
    gateway: opts.gateway,
    repoId: opts.repoId,
    githubHttpsBase: opts.githubHttpsBase,
    sourceSha: opts.sourceSha,
    decidedAt: new Date(),
    embeddingModelId: opts.embeddingModelId,
    drafts: allDrafts,
  });
  result.inserted = inserted;
  return result;
}
