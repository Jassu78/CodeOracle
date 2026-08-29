import { eq } from "drizzle-orm";
import type { Env } from "@codeoracle/config";
import type { ExtractDecisionsJobPayload, ProvidersConfig } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import { githubSources, finishJobHistory, repos, startJobHistory, type Database } from "@codeoracle/db";
import {
  extractDecisionsFromSource,
  filterByConfidence,
  isTrivialSourceMessage,
} from "@codeoracle/extraction";
import { ProviderRegistry } from "@codeoracle/gateway";
import { logProviderUsage } from "@codeoracle/observability";
import { createQdrantClient } from "@codeoracle/retrieval";
import type IORedis from "ioredis";
import { resolveRepoRoot } from "../crawler/github-clone.js";
import { withExtractConcurrency } from "../lib/extract-concurrency.js";
import {
  MIN_EXTRACTION_CONFIDENCE,
  persistExtractedDecisions,
} from "../lib/persist-decisions.js";
import { resolveTouchedPathsAndDiffSummary } from "../lib/resolve-touched-paths.js";

export async function runExtractDecisions(opts: {
  env: Env;
  providers: ProvidersConfig;
  redis: IORedis;
  db: Database;
  payload: ExtractDecisionsJobPayload;
}): Promise<{ inserted: number; skipped: boolean }> {
  return withExtractConcurrency(opts.redis, opts.env.EXTRACT_CONCURRENCY, async () => {
    const started = Date.now();
    const minConfidence = opts.env.EXTRACT_MIN_CONFIDENCE ?? MIN_EXTRACTION_CONFIDENCE;
    const jobHistoryId = await startJobHistory(opts.db, {
      repoId: opts.payload.repoId,
      jobType: JOB_NAMES.EXTRACT_DECISIONS,
      afterSha: opts.payload.githubSourceId,
    });

    try {
      const [source] = await opts.db
        .select()
        .from(githubSources)
        .where(eq(githubSources.id, opts.payload.githubSourceId))
        .limit(1);

      if (!source) {
        await finishJobHistory(opts.db, jobHistoryId, {
          status: "done",
          latencyMs: Date.now() - started,
        });
        return { inserted: 0, skipped: true };
      }

      if (!source.sourceUrl) {
        await finishJobHistory(opts.db, jobHistoryId, {
          status: "done",
          latencyMs: Date.now() - started,
        });
        return { inserted: 0, skipped: true };
      }

      const [repo] = await opts.db
        .select()
        .from(repos)
        .where(eq(repos.id, opts.payload.repoId))
        .limit(1);
      if (!repo?.embeddingModelId) {
        throw new Error(`Repo ${opts.payload.repoId} missing embeddingModelId — index before extract`);
      }

      const gateway = new ProviderRegistry({
        config: opts.providers,
        env: process.env,
        onUsage: logProviderUsage,
        redis: opts.redis,
      });

      const body = source.body ?? "";
      const title = source.title ?? "";
      if (!`${title}\n${body}`.trim()) {
        await finishJobHistory(opts.db, jobHistoryId, {
          status: "done",
          latencyMs: Date.now() - started,
        });
        return { inserted: 0, skipped: true };
      }

      // Defense in depth — queue already filters, but older jobs may still be pending.
      if (isTrivialSourceMessage(title, body)) {
        await finishJobHistory(opts.db, jobHistoryId, {
          status: "done",
          latencyMs: Date.now() - started,
        });
        return { inserted: 0, skipped: true };
      }

      const sourceType = source.sourceType === "pr" ? "pr" : "commit";
      const decidedAt = source.mergedAt ?? source.createdAt;

      const repoRoot = resolveRepoRoot({
        localClonePath: repo.localClonePath,
        cloneRoot: opts.env.CODEORACLE_CLONE_DIR,
        githubFullName: repo.githubFullName,
      });

      const { paths: deterministicPaths, diffSummary } = await resolveTouchedPathsAndDiffSummary({
        repoRoot,
        githubFullName: repo.githubFullName,
        localClonePath: repo.localClonePath,
        githubPat: opts.env.GITHUB_PAT,
        sourceType,
        externalId: source.externalId,
        sourceSha: source.sourceSha,
        rawJson: source.rawJson,
      });

      const extraction = await extractDecisionsFromSource({
        gateway,
        source: {
          sourceType,
          title,
          body,
          sourceUrl: source.sourceUrl,
          sourceSha: source.sourceSha,
          decidedAtIso: decidedAt.toISOString(),
          diffSummary,
        },
      });

      // Record the provider that actually answered (after failover), not primary config.
      const extractionModelId = `${extraction.providerId}:${extraction.model}`;

      let confident = filterByConfidence(extraction.batch, minConfidence);
      // Prefer deterministic paths over model-invented touchedPaths when available.
      if (deterministicPaths.length > 0) {
        const allowed = new Set(deterministicPaths);
        confident = confident.map((d) => ({
          ...d,
          touchedPaths:
            d.touchedPaths.filter((p) => allowed.has(p)).length > 0
              ? d.touchedPaths.filter((p) => allowed.has(p))
              : deterministicPaths.slice(0, 40),
        }));
      }

      if (confident.length === 0) {
        await finishJobHistory(opts.db, jobHistoryId, {
          status: "done",
          latencyMs: Date.now() - started,
          tokensUsed: extraction.tokensUsed,
        });
        return { inserted: 0, skipped: false };
      }

      const qdrant = createQdrantClient(opts.env.QDRANT_URL);
      const { inserted } = await persistExtractedDecisions({
        db: opts.db,
        qdrant,
        gateway,
        repoId: opts.payload.repoId,
        sourceType,
        sourceUrl: source.sourceUrl,
        sourceSha: source.sourceSha,
        decidedAt,
        extractionModelId,
        embeddingModelId: repo.embeddingModelId,
        extracted: confident,
      });

      await finishJobHistory(opts.db, jobHistoryId, {
        status: "done",
        latencyMs: Date.now() - started,
        tokensUsed: extraction.tokensUsed,
      });

      return { inserted, skipped: false };
    } catch (err) {
      await finishJobHistory(opts.db, jobHistoryId, {
        status: "error",
        latencyMs: Date.now() - started,
      });
      throw err;
    }
  });
}
