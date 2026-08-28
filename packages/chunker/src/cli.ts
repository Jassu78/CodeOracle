#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { chunkFile } from "./registry.js";

/**
 * Debug CLI: `pnpm chunk ./some-file.ts` prints chunks to stdout.
 * No embedding or MCP — proves chunk boundaries are correct first.
 */
function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: codeoracle-chunk <file>");
    process.exit(1);
  }

  const source = readFileSync(filePath, "utf-8");
  const chunks = chunkFile(filePath, source);

  console.log(`Found ${chunks.length} chunk(s) in ${filePath}:\n`);
  for (const chunk of chunks) {
    const label = chunk.parentSymbol ? `${chunk.parentSymbol}.${chunk.symbolName}` : chunk.symbolName;
    console.log(`— ${label ?? "(window)"} [${chunk.language}] bytes ${chunk.byteStart}-${chunk.byteEnd}`);
  }
}

main();
