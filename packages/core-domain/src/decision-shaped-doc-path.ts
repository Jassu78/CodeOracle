/**
 * Decision-shaped documentation paths — language-agnostic classes for P1-A.
 * These files may be indexed as Decision rows (sourceType=doc), not only code_chunks.
 */

function basename(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  return normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
}

/**
 * True when a repo-relative path is a first-class decision doc class:
 * - SAFETY.md (any directory)
 * - ARCHITECTURE.md (any directory)
 * - ADR*.md (basename prefix, markdown only)
 * - markdown under docs/.../decisions/
 */
export function isDecisionShapedDocPath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) return false;
  const base = basename(normalized);
  if (!base) return false;

  if (/^safety\.md$/i.test(base)) return true;
  if (/^architecture\.md$/i.test(base)) return true;
  if (/^adr.*\.md$/i.test(base)) return true;

  if (/\.md$/i.test(base) && /(^|\/)docs\/(?:.+\/)?decisions\//i.test(normalized)) {
    return true;
  }

  return false;
}
