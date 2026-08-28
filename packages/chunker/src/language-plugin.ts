import type { RawChunk } from "@codeoracle/contracts";

/**
 * Port interface: isolate each language behind a LanguagePlugin so adding
 * Go/Java/Rust/C++ later is additive, never a rewrite of the chunker core.
 */
export interface LanguagePlugin {
  readonly language: string;
  readonly fileExtensions: string[];
  chunk(filePath: string, source: string): RawChunk[];
}
