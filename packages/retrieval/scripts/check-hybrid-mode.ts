/**
 * Non-destructive hybrid smoke: report collection mode + sparse encoder homogeneity (E3).
 * Activating hybrid / BM25: full reindex via prepareChunksCollectionForFullIndex
 * (scoped clear when already hybrid; recreate only for legacy-dense).
 *
 * Exit codes:
 * - 0 hybrid + homogeneous sparse_encoder (or empty)
 * - 2 not hybrid
 * - 3 hybrid but mixed/legacy sparse encodings (full reindex required)
 * - 1 unexpected error
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import {
  createQdrantClient,
  getChunksCollectionMode,
  probeSparseEncoderHomogeneity,
} from "../src/index.js";

async function main(): Promise<void> {
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  loadProjectEnv(root);
  const env = loadEnv();
  const client = createQdrantClient(env.QDRANT_URL);
  const mode = await getChunksCollectionMode(client);
  console.error(`code_chunks mode=${mode}`);
  if (mode !== "hybrid") {
    process.exit(2);
  }

  const probe = await probeSparseEncoderHomogeneity(client);
  console.error(
    `sparse_encoder expected=${probe.expectedVersion} sampled=${probe.sampled} ` +
      `legacy_or_missing=${probe.legacyOrMissing} mismatched=${probe.mismatched} ` +
      `homogeneous=${probe.homogeneous}`,
  );
  if (!probe.homogeneous) {
    console.error(
      "Mixed or legacy sparse encodings detected — run a full reindex before relying on hybrid search.",
    );
    process.exit(3);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
