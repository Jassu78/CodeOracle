/**
 * Non-destructive hybrid smoke: report collection mode only.
 * Activating hybrid on dogfood: full reindex via prepareChunksCollectionForFullIndex
 * (scoped clear when already hybrid; recreate only for legacy-dense).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { createQdrantClient, getChunksCollectionMode } from "../src/index.js";

async function main(): Promise<void> {
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  loadProjectEnv(root);
  const env = loadEnv();
  const mode = await getChunksCollectionMode(createQdrantClient(env.QDRANT_URL));
  console.error(`code_chunks mode=${mode}`);
  process.exit(mode === "hybrid" ? 0 : 2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
