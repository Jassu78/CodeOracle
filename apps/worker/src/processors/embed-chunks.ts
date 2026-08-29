import { and, inArray, ne } from "drizzle-orm";
import type { EmbedChunksJobPayload } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import type { Env } from "@codeoracle/config";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { chunks, finishJobHistory, markChunksEmbeddingStatus, startJobHistory, type Database } from "@codeoracle/db";
import { ProviderRegistry } from "@codeoracle/gateway";
import { logProviderUsage } from "@codeoracle/observability";
import { createQdrantClient, ensureChunksCollection, upsertChunkVectors } from "@codeoracle/retrieval";
import type IORedis from "ioredis";
import { finalizeIndexIfComplete } from "./full-index.js";
import { markFileComplete } from "../lib/index-progress.js";

const EMBED_BATCH_DEFAULT = 32;

export async function runEmbedChunks(opts: {
  env: Env;
  providers: ProvidersConfig;
  redis: IORedis;
  db: Database;
  queue: import("bullmq").Queue;
  payload: EmbedChunksJobPayload;
}): Promise<{ embedded: number }> {
  const embedBatch = opts.env.EMBED_BATCH_SIZE ?? EMBED_BATCH_DEFAULT;
  const gateway = new ProviderRegistry({
    config: opts.providers,
    env: process.env,
    onUsage: logProviderUsage,
    redis: opts.redis,
  });
  const qdrant = createQdrantClient(opts.env.QDRANT_URL);
  const started = Date.now();
  const jobHistoryId = await startJobHistory(opts.db, {
    repoId: opts.payload.repoId,
    jobType: JOB_NAMES.EMBED_CHUNKS,
    dedupeKey: `${opts.payload.indexRunId}/embed/${opts.payload.filePath}`,
  });

  try {
    // Retries (provider failover, BullMQ re-attempt) must not re-embed rows a
    // prior attempt already finished — only re-run what's still pending.
    const rows = await opts.db
      .select()
      .from(chunks)
      .where(
        and(inArray(chunks.id, opts.payload.chunkIds), ne(chunks.embeddingStatus, "embedded")),
      );

    if (rows.length === 0) {
      await finishJobHistory(opts.db, jobHistoryId, { status: "done", latencyMs: Date.now() - started });
      await markFileComplete(opts.redis, opts.payload.repoId);
      await finalizeIndexIfComplete({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        repoId: opts.payload.repoId,
        queue: opts.queue,
      });
      return { embedded: 0 };
    }

    let embedded = 0;
    for (let i = 0; i < rows.length; i += embedBatch) {
      const batch = rows.slice(i, i + embedBatch);
      const embedResult = await gateway.embed(batch.map((b) => b.content));
      if (embedResult.vectors.length !== batch.length) {
        throw new Error(
          `Embedding count mismatch: expected ${batch.length}, got ${embedResult.vectors.length}`,
        );
      }

      const vectorSize = embedResult.vectors[0]?.length;
      if (!vectorSize) throw new Error("Embedding provider returned empty vector batch");

      await ensureChunksCollection(qdrant, vectorSize);
      await upsertChunkVectors(
        qdrant,
        batch.map((row, idx) => ({
          id: row.id,
          vector: embedResult.vectors[idx]!,
          sparseText: row.content,
          payload: {
            repo_id: opts.payload.repoId,
            file_path: row.filePath,
            symbol_name: row.symbolName,
            embedding_model_id: opts.payload.embeddingModelId,
            chunk_id: row.id,
          },
        })),
      );
      await markChunksEmbeddingStatus(
        opts.db,
        batch.map((row) => row.id),
        "embedded",
      );
      embedded += batch.length;
    }

    await finishJobHistory(opts.db, jobHistoryId, {
      status: "done",
      latencyMs: Date.now() - started,
    });

    await markFileComplete(opts.redis, opts.payload.repoId);
    await finalizeIndexIfComplete({
      env: opts.env,
      redis: opts.redis,
      db: opts.db,
      repoId: opts.payload.repoId,
      queue: opts.queue,
    });

    return { embedded };
  } catch (err) {
    await finishJobHistory(opts.db, jobHistoryId, { status: "error", latencyMs: Date.now() - started });
    throw err;
  }
}
