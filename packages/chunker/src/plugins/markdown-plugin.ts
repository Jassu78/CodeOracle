import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "../language-plugin.js";
import { hashContent } from "../hash.js";

/** Soft cap before a single heading section is window-split (matches fallback). */
const SECTION_MAX_BYTES = 2000;
const WINDOW_OVERLAP_BYTES = 200;

/** Same-line ATX only — do not let `\s` cross newlines into the next line. */
const ATX_HEADING_LINE = /^(#{1,6})[ \t]+([^\n]+?)[ \t]*$/;

/** CommonMark optional closing sequence: trailing ` # # #` after the title. */
function normalizeAtxTitle(raw: string): string {
  return raw.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

function isFenceLine(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trimStart());
}

export type AtxHeading = {
  index: number;
  title: string;
  /** 1–6 from the leading `#` count. */
  depth: number;
};

/**
 * Collect ATX headings that are not inside fenced code blocks.
 * Returns absolute start offsets into `source` and trimmed titles.
 */
export function findAtxHeadings(source: string): AtxHeading[] {
  const headings: AtxHeading[] = [];
  let offset = 0;
  let inFence = false;

  while (offset <= source.length) {
    const nextNl = source.indexOf("\n", offset);
    const lineEnd = nextNl === -1 ? source.length : nextNl;
    const line = source.slice(offset, lineEnd);

    if (isFenceLine(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const match = ATX_HEADING_LINE.exec(line);
      if (match) {
        const title = normalizeAtxTitle(match[2]!);
        if (title) {
          headings.push({
            index: offset,
            title,
            depth: match[1]!.length,
          });
        }
      }
    }

    if (nextNl === -1) break;
    offset = nextNl + 1;
  }

  return headings;
}

/** Nearest open ancestor title for each heading (stack by depth). */
export function parentSymbolsForHeadings(headings: AtxHeading[]): Array<string | null> {
  const parents: Array<string | null> = [];
  const stack: AtxHeading[] = [];

  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= heading.depth) {
      stack.pop();
    }
    parents.push(stack.length > 0 ? stack[stack.length - 1]!.title : null);
    stack.push(heading);
  }

  return parents;
}

function pushWindowed(
  chunks: RawChunk[],
  filePath: string,
  source: string,
  start: number,
  end: number,
  symbolName: string | null,
  parentSymbol: string | null,
): void {
  const length = end - start;
  if (length <= 0) return;
  if (length <= SECTION_MAX_BYTES) {
    const content = source.slice(start, end);
    chunks.push({
      filePath,
      symbolName,
      parentSymbol,
      language: "markdown",
      byteStart: start,
      byteEnd: end,
      content,
      contentHash: hashContent(content),
    });
    return;
  }
  const step = SECTION_MAX_BYTES - WINDOW_OVERLAP_BYTES;
  for (let offset = start; offset < end; offset += step) {
    const windowEnd = Math.min(offset + SECTION_MAX_BYTES, end);
    const content = source.slice(offset, windowEnd);
    chunks.push({
      filePath,
      symbolName,
      parentSymbol,
      language: "markdown",
      byteStart: offset,
      byteEnd: windowEnd,
      content,
      contentHash: hashContent(content),
    });
    if (windowEnd === end) break;
  }
}

/**
 * Chunk markdown by ATX headings so docs retrieve as coherent sections.
 * Preamble before the first heading is kept; oversized sections window-split.
 * Headings inside fenced code are ignored. Nested headings set parentSymbol.
 */
export const markdownPlugin: LanguagePlugin = {
  language: "markdown",
  fileExtensions: [".md", ".mdx", ".markdown"],
  chunk(filePath: string, source: string): RawChunk[] {
    if (!source) return [];

    const headings = findAtxHeadings(source);
    const chunks: RawChunk[] = [];
    if (headings.length === 0) {
      pushWindowed(chunks, filePath, source, 0, source.length, null, null);
      return chunks;
    }

    if (headings[0]!.index > 0) {
      pushWindowed(chunks, filePath, source, 0, headings[0]!.index, null, null);
    }

    const parents = parentSymbolsForHeadings(headings);
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i]!.index;
      const end = i + 1 < headings.length ? headings[i + 1]!.index : source.length;
      pushWindowed(
        chunks,
        filePath,
        source,
        start,
        end,
        headings[i]!.title,
        parents[i]!,
      );
    }

    return chunks;
  },
};
