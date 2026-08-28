import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "../language-plugin.js";
import { hashContent } from "../hash.js";

const WINDOW_SIZE_BYTES = 2000;
const WINDOW_OVERLAP_BYTES = 200;

/**
 * Fixed-size sliding-window chunking with overlap, used ONLY for
 * files/languages with no tree-sitter grammar available. Never silently
 * drops a file.
 */
export function createFallbackPlugin(language: string): LanguagePlugin {
  return {
    language,
    fileExtensions: [],
    chunk(filePath: string, source: string): RawChunk[] {
      const chunks: RawChunk[] = [];
      const step = WINDOW_SIZE_BYTES - WINDOW_OVERLAP_BYTES;
      for (let start = 0; start < source.length; start += step) {
        const end = Math.min(start + WINDOW_SIZE_BYTES, source.length);
        const content = source.slice(start, end);
        chunks.push({
          filePath,
          symbolName: null,
          parentSymbol: null,
          language,
          byteStart: start,
          byteEnd: end,
          content,
          contentHash: hashContent(content),
        });
        if (end === source.length) break;
      }
      return chunks;
    },
  };
}
