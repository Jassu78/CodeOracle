import type { DecisionExtractionResult } from "@codeoracle/contracts";

/** Deterministic doc-index marker — not LLM confidence. */
export const DOC_INDEX_EXTRACTION_MODEL_ID = "doc-index:v1";
export const DOC_INDEX_CONFIDENCE = 0.75;

export const DOC_INDEX_MAX_FILE_BYTES = 200_000;
export const DOC_INDEX_MAX_SECTIONS_PER_FILE = 20;
export const DOC_INDEX_MAX_DECISIONS_PER_RUN = 100;
export const DOC_INDEX_MAX_SUMMARY_CHARS = 4_000;

const ATX_H2 = /^##[ \t]+([^\n]+?)[ \t]*$/;

export type DocDecisionDraft = DecisionExtractionResult & {
  /** 1-based start line for blob #L fragment (optional). */
  startLine: number;
};

function normalizeTitle(raw: string): string {
  return raw.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

function topicFromPath(filePath: string): string {
  const base = filePath.includes("/")
    ? filePath.slice(filePath.lastIndexOf("/") + 1)
    : filePath;
  return base.replace(/\.md$/i, "") || base;
}

function truncateSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DOC_INDEX_MAX_SUMMARY_CHARS) return trimmed;
  return `${trimmed.slice(0, DOC_INDEX_MAX_SUMMARY_CHARS - 1)}…`;
}

/**
 * Split a decision-shaped markdown file into Decision drafts.
 * Uses H2 (`##`) sections when present; otherwise one decision for the whole file.
 */
export function buildDocDecisionDrafts(
  filePath: string,
  source: string,
): DocDecisionDraft[] {
  const normalizedPath = filePath.trim().replace(/\\/g, "/");
  if (!source.trim()) return [];

  const lines = source.split(/\r?\n/);
  const h2Indexes: Array<{ lineIdx: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = ATX_H2.exec(lines[i]!);
    if (!match) continue;
    const title = normalizeTitle(match[1]!);
    if (title) h2Indexes.push({ lineIdx: i, title });
  }

  const drafts: DocDecisionDraft[] = [];

  if (h2Indexes.length === 0) {
    const summary = truncateSummary(source);
    if (!summary) return [];
    drafts.push({
      topic: topicFromPath(normalizedPath),
      summary,
      alternativesConsidered: [],
      confidence: DOC_INDEX_CONFIDENCE,
      touchedPaths: [normalizedPath],
      startLine: 1,
    });
    return drafts.slice(0, DOC_INDEX_MAX_SECTIONS_PER_FILE);
  }

  for (let i = 0; i < h2Indexes.length && drafts.length < DOC_INDEX_MAX_SECTIONS_PER_FILE; i++) {
    const start = h2Indexes[i]!.lineIdx;
    const end = i + 1 < h2Indexes.length ? h2Indexes[i + 1]!.lineIdx : lines.length;
    const body = lines.slice(start, end).join("\n");
    const summary = truncateSummary(body);
    if (!summary) continue;
    drafts.push({
      topic: h2Indexes[i]!.title.slice(0, 500),
      summary,
      alternativesConsidered: [],
      confidence: DOC_INDEX_CONFIDENCE,
      touchedPaths: [normalizedPath],
      startLine: start + 1,
    });
  }

  return drafts;
}

/** GitHub blob citation URL; caller must pass a real https://github.com/... base. */
export function githubBlobCitationUrl(opts: {
  githubHttpsBase: string;
  sha: string;
  filePath: string;
  startLine?: number;
}): string {
  const base = opts.githubHttpsBase.replace(/\/$/, "");
  const encoded = opts.filePath
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const url = `${base}/blob/${opts.sha}/${encoded}`;
  return opts.startLine && opts.startLine > 0 ? `${url}#L${opts.startLine}` : url;
}
