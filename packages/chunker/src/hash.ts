import { createHash } from "node:crypto";

/** Content hash used for incremental-reindex change detection. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
