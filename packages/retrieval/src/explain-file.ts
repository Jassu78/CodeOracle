import {
  ExplainFileOutputSchema,
  type ExplainFileOutput,
} from "@codeoracle/contracts";
import {
  listChunksByFilePath,
  listDecisionsTouchingPath,
  type ChunkRow,
  type Database,
  type DecisionRow,
} from "@codeoracle/db";
import { isHttpUrl } from "./util.js";

export type ExplainFileDeps = {
  listChunks: (repoId: string, filePath: string) => Promise<ChunkRow[]>;
  listDecisions: (repoId: string, filePath: string) => Promise<DecisionRow[]>;
};

export type ExplainFileOpts = {
  db: Database;
  repoId: string;
  path: string;
  /** Max chunk summary lines. Default 40. */
  maxChunkSummaries?: number;
  /** Test seam — production callers omit this. */
  deps?: ExplainFileDeps;
};

/**
 * Deterministic file explanation for MCP `explain_file`.
 * Postgres chunks by path + decisions touching that path. No LLM.
 */
export async function explainFile(opts: ExplainFileOpts): Promise<ExplainFileOutput> {
  const path = opts.path.trim();
  if (!path) {
    throw new Error("explainFile: path must be non-empty");
  }
  if (!opts.repoId.trim()) {
    throw new Error("explainFile: repoId must be non-empty");
  }

  const maxSummaries = opts.maxChunkSummaries ?? 40;
  const deps: ExplainFileDeps = opts.deps ?? {
    listChunks: (repoId, filePath) => listChunksByFilePath(opts.db, repoId, filePath),
    listDecisions: (repoId, filePath) => listDecisionsTouchingPath(opts.db, repoId, filePath),
  };

  const chunkRows = await deps.listChunks(opts.repoId, path);
  const decisionRows = await deps.listDecisions(opts.repoId, path);

  const chunkSummaries = chunkRows.slice(0, maxSummaries).map(formatChunkSummary);

  const relatedDecisions: ExplainFileOutput["relatedDecisions"] = [];
  for (const row of decisionRows) {
    const sourceUrl = row.sourceUrl?.trim() ?? "";
    if (!isHttpUrl(sourceUrl)) continue;

    relatedDecisions.push({
      topic: row.topic,
      summary: row.summary,
      sourceUrl,
      decidedAt: row.decidedAt.toISOString(),
      superseded: Boolean(row.supersededBy),
    });
  }

  return ExplainFileOutputSchema.parse({
    path,
    chunkSummaries,
    relatedDecisions,
  });
}

function formatChunkSummary(row: ChunkRow): string {
  const symbol = row.symbolName?.trim() ? `${row.symbolName} ` : "";
  const preview = row.content.replace(/\s+/g, " ").trim().slice(0, 160);
  const ellipsis = row.content.replace(/\s+/g, " ").trim().length > 160 ? "…" : "";
  return `${symbol}[${row.byteStart}-${row.byteEnd}] ${preview}${ellipsis}`;
}
