import { randomUUID } from "node:crypto";
import { chunkFile, hashContent } from "@codeoracle/chunker";
import type { ChunkFileJobPayload } from "@codeoracle/contracts";
import { JOB_NAMES } from "@codeoracle/contracts";
import type { Env } from "@codeoracle/config";
import { chunks, finishJobHistory, startJobHistory, type Database } from "@codeoracle/db";
import { bullJobId } from "@codeoracle/queue";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { readRepoFile } from "../crawler/walk-files.js";
import { markFileComplete } from "../lib/index-progress.js";
import { finalizeIndexIfComplete } from "./full-index.js";

export async function runChunkFile(opts: {
  env: Env;
  redis: IORedis;
  db: Database;
  queue: Queue;
  payload: ChunkFileJobPayload;
}): Promise<{ chunkCount: number }> {
  const started = Date.now();
  const jobHistoryId = await startJobHistory(opts.db, {
    repoId: opts.payload.repoId,
    jobType: JOB_NAMES.CHUNK_FILE,
    dedupeKey: `${opts.payload.indexRunId}/${opts.payload.filePath}`,
  });

  try {
    const source = await readRepoFile(opts.payload.repoRoot, opts.payload.filePath);

    // Binary / non-text files (null bytes) must not be inserted into Postgres text columns.
    if (source.includes("\0")) {
      await finishJobHistory(opts.db, jobHistoryId, { status: "done", latencyMs: Date.now() - started });
      await markFileComplete(opts.redis, opts.payload.repoId);
      await finalizeIndexIfComplete({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        repoId: opts.payload.repoId,
        queue: opts.queue,
      });
      return { chunkCount: 0 };
    }

    const chunkIds: string[] = [];
    const rows = [];

    for (const raw of chunkFile(opts.payload.filePath, source)) {
      const chunkId = randomUUID();
      rows.push({
        id: chunkId,
        repoId: opts.payload.repoId,
        filePath: raw.filePath,
        symbolName: raw.symbolName,
        parentSymbol: raw.parentSymbol,
        language: raw.language,
        byteStart: raw.byteStart,
        byteEnd: raw.byteEnd,
        content: raw.content,
        contentHash: hashContent(raw.content),
        embeddingModelId: opts.payload.embeddingModelId,
        qdrantPointId: chunkId,
        lastIndexedSha: opts.payload.sha,
      });
      chunkIds.push(chunkId);
    }

    if (rows.length > 0) {
      await opts.db.insert(chunks).values(rows);
    }

    if (chunkIds.length > 0) {
      await opts.queue.add(
        JOB_NAMES.EMBED_CHUNKS,
        {
          repoId: opts.payload.repoId,
          chunkIds,
          embeddingModelId: opts.payload.embeddingModelId,
          filePath: opts.payload.filePath,
          sha: opts.payload.sha,
          indexRunId: opts.payload.indexRunId,
        },
        {
          jobId: bullJobId("embed_chunks", opts.payload.repoId, opts.payload.indexRunId, opts.payload.filePath),
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      );
    } else {
      await markFileComplete(opts.redis, opts.payload.repoId);
      await finalizeIndexIfComplete({
        env: opts.env,
        redis: opts.redis,
        db: opts.db,
        repoId: opts.payload.repoId,
        queue: opts.queue,
      });
    }

    await finishJobHistory(opts.db, jobHistoryId, { status: "done", latencyMs: Date.now() - started });
    return { chunkCount: chunkIds.length };
  } catch (err) {
    await finishJobHistory(opts.db, jobHistoryId, { status: "error", latencyMs: Date.now() - started });
    throw err;
  }
}
