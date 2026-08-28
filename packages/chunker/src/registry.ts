import { extname } from "node:path";
import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "./language-plugin.js";
import { typescriptPlugin } from "./plugins/typescript-plugin.js";
import { pythonPlugin } from "./plugins/python-plugin.js";
import { createFallbackPlugin } from "./plugins/fallback-plugin.js";

const PLUGINS: LanguagePlugin[] = [typescriptPlugin, pythonPlugin];

function findPluginFor(filePath: string): LanguagePlugin {
  const ext = extname(filePath);
  const found = PLUGINS.find((p) => p.fileExtensions.includes(ext));
  return found ?? createFallbackPlugin(`unknown(${ext || "no-ext"})`);
}

/** Chunk a single file's source, dispatching to the correct language plugin. */
export function chunkFile(filePath: string, source: string): RawChunk[] {
  const plugin = findPluginFor(filePath);
  return plugin.chunk(filePath, source);
}
