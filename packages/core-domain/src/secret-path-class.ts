/**
 * Secret path / payload policy for index + retrieval — language-agnostic.
 *
 * Failure class (P0-A): basename `.env2` is not matched by ignore pattern
 * `.env.*` (requires a second dot). Agents then received live credentials from
 * search/explain on already-indexed points.
 *
 * Defense in depth: deny at crawl AND refuse at hydrate/explain even if a
 * stale vector still exists until full reindex.
 */

/** ignore(7) patterns — hard-deny even when git-tracked. */
export const SECRET_PATH_IGNORE_PATTERNS: readonly string[] = [
  // Dotenv class: `.env`, `.env2`, `.env.local`, `.env.staging.local`, …
  // Prefer precise globs over `.env*` so `.envoy` / `.environment` are not denied.
  ".env",
  ".env.*",
  ".env[0-9]*",
  "**/.env",
  "**/.env.*",
  "**/.env[0-9]*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/credentials.json",
  "**/secrets.json",
  "**/secrets.yaml",
  "**/secrets.yml",
  ".npmrc",
  "**/.npmrc",
  "**/.aws/credentials",
];

/**
 * Basename looks like a dotenv / env-file secret store.
 * Allows product source such as `src/config/env.ts` (no leading `.env`).
 * Does not treat `.envoy` / `.environment` / `.envrc` as dotenv secrets (F4).
 */
export function isDotenvSecretBasename(baseName: string): boolean {
  // `.env` | `.env.<suffix>` | `.env2` / `.env23` …
  return /^\.env($|\.|[0-9])/i.test(baseName.trim());
}

/**
 * Repo-relative path must never be indexed or returned via MCP tools.
 */
export function isSecretIndexedPath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized) return false;

  const base = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;

  if (isDotenvSecretBasename(base)) return true;
  if (/^\.npmrc$/i.test(base)) return true;
  if (/^id_rsa(\.|$)/i.test(base)) return true;
  if (/\.(pem|key)$/i.test(base)) return true;
  if (/^(credentials|secrets)\.(json|ya?ml)$/i.test(base)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(normalized)) return true;

  return false;
}

const HIGH_CONFIDENCE_SECRET_CONTENT: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgho_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  // Require userinfo so credential-less docs (`mongodb://localhost/db`) are not refused.
  /\bmongodb(?:\+srv)?:\/\/[^\s/@]+:[^\s/@]+@/i,
  /\bLANGFUSE_[A-Z0-9_]*=\S{8,}/,
  /\bGEMINI_API_KEY=\S{8,}/,
  /\bOPENAI_API_KEY=\S{8,}/,
  /\bAWS_SECRET_ACCESS_KEY=\S{8,}/,
];

/**
 * High-confidence secret material in chunk/file body.
 * Used only as a refuse gate for already-indexed stale points — not a
 * substitute for crawl denylist.
 */
export function contentLooksLikeSecretMaterial(text: string): boolean {
  if (!text) return false;
  return HIGH_CONFIDENCE_SECRET_CONTENT.some((re) => re.test(text));
}

/**
 * True when path or body must not be returned to agents.
 */
export function mustRefuseSecretRetrieval(filePath: string, content?: string | null): boolean {
  if (isSecretIndexedPath(filePath)) return true;
  if (content != null && contentLooksLikeSecretMaterial(content)) return true;
  return false;
}
