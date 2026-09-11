import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "../language-plugin.js";
import { hashContent } from "../hash.js";

const TARGET_BYTES = 1800;
const HARD_MAX_BYTES = 2000;
const WINDOW_OVERLAP_BYTES = 200;

function pushChunk(
  chunks: RawChunk[],
  filePath: string,
  source: string,
  start: number,
  end: number,
): void {
  if (end <= start) return;
  const content = source.slice(start, end);
  chunks.push({
    filePath,
    symbolName: null,
    parentSymbol: null,
    language: "text",
    byteStart: start,
    byteEnd: end,
    content,
    contentHash: hashContent(content),
  });
}

/**
 * Paragraph-aware chunking for plain prose (.txt / .rst / .adoc).
 * Merges blank-line paragraphs up to a soft size; hard-caps with overlap.
 */
export const textPlugin: LanguagePlugin = {
  language: "text",
  fileExtensions: [".txt", ".rst", ".adoc"],
  chunk(filePath: string, source: string): RawChunk[] {
    if (!source) return [];

    const chunks: RawChunk[] = [];
    const paragraphBreak = /\n\s*\n/g;
    const bounds: number[] = [0];
    let match: RegExpExecArray | null;
    while ((match = paragraphBreak.exec(source)) !== null) {
      bounds.push(match.index + match[0].length);
    }

    let groupStart = 0;
    let cursor = 0;

    const flush = (end: number) => {
      if (end <= groupStart) return;
      if (end - groupStart <= HARD_MAX_BYTES) {
        pushChunk(chunks, filePath, source, groupStart, end);
      } else {
        const step = HARD_MAX_BYTES - WINDOW_OVERLAP_BYTES;
        for (let offset = groupStart; offset < end; offset += step) {
          const windowEnd = Math.min(offset + HARD_MAX_BYTES, end);
          pushChunk(chunks, filePath, source, offset, windowEnd);
          if (windowEnd === end) break;
        }
      }
      groupStart = end;
    };

    for (let i = 0; i < bounds.length; i++) {
      const paraStart = bounds[i]!;
      const paraEnd = i + 1 < bounds.length ? bounds[i + 1]! : source.length;
      const nextLen = paraEnd - groupStart;
      if (cursor > groupStart && nextLen > TARGET_BYTES) {
        flush(paraStart);
      }
      cursor = paraEnd;
    }
    flush(source.length);

    return chunks;
  },
};
