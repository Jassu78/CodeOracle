import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Env } from "./env.js";

/** Compose / .env.example placeholder — never allowed in NODE_ENV=production. */
export const DEV_SECRET_PLACEHOLDER = "change-me-in-dev";

export function isLoopbackBindHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "localhost" ||
    h === "::ffff:127.0.0.1"
  );
}

/**
 * Effective bind host for safety checks.
 * Node `server.listen(port)` with no host binds all interfaces → treat as `0.0.0.0`.
 */
export function effectiveBindHost(configured: string | undefined): string {
  const trimmed = configured?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "0.0.0.0";
}

export class ProductionSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSafetyError";
  }
}

export type ProductionSafetyOpts = {
  /**
   * Hosts this process will bind (API / MCP HTTP).
   * Empty = no bind-auth check (e.g. worker / CLI / MCP stdio).
   */
  bindHosts?: string[];
  /**
   * Which process is binding. API non-loopback requires `API_TOKEN` only.
   * MCP HTTP may use `API_TOKEN` or `MCP_HTTP_BEARER_TOKEN`.
   */
  bindKind?: "api" | "mcp";
};

/**
 * Fail closed when NODE_ENV=production:
 * - DATABASE_URL must not contain the compose placeholder password
 * - GITHUB_WEBHOOK_SECRET / API_TOKEN / MCP_HTTP_BEARER_TOKEN must not be the placeholder literal
 * - Non-loopback API bind requires API_TOKEN
 * - Non-loopback MCP HTTP bind requires API_TOKEN or MCP_HTTP_BEARER_TOKEN
 *
 * Does not replace P0-A crawl/search secret path denylist.
 */
export function assertProductionSafety(env: Env, opts: ProductionSafetyOpts = {}): void {
  if (env.NODE_ENV !== "production") return;

  if (env.DATABASE_URL.includes(DEV_SECRET_PLACEHOLDER)) {
    throw new ProductionSafetyError(
      "NODE_ENV=production refuses DATABASE_URL containing the development placeholder " +
        `"${DEV_SECRET_PLACEHOLDER}". Set a real Postgres password.`,
    );
  }

  const webhook = env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  if (webhook === DEV_SECRET_PLACEHOLDER) {
    throw new ProductionSafetyError(
      "NODE_ENV=production refuses GITHUB_WEBHOOK_SECRET=" +
        `"${DEV_SECRET_PLACEHOLDER}". Set a real webhook secret (or leave unset if unused).`,
    );
  }

  const apiToken = env.API_TOKEN?.trim() ?? "";
  if (apiToken === DEV_SECRET_PLACEHOLDER) {
    throw new ProductionSafetyError(
      "NODE_ENV=production refuses API_TOKEN=" +
        `"${DEV_SECRET_PLACEHOLDER}". Set a real API token (or leave unset on loopback-only binds).`,
    );
  }

  const mcpBearer = env.MCP_HTTP_BEARER_TOKEN?.trim() ?? "";
  if (mcpBearer === DEV_SECRET_PLACEHOLDER) {
    throw new ProductionSafetyError(
      "NODE_ENV=production refuses MCP_HTTP_BEARER_TOKEN=" +
        `"${DEV_SECRET_PLACEHOLDER}". Set a real bearer token (or leave unset if unused).`,
    );
  }

  const hosts = opts.bindHosts ?? [];
  const exposesNonLoopback = hosts.some((h) => !isLoopbackBindHost(effectiveBindHost(h)));
  if (!exposesNonLoopback) return;

  const kind = opts.bindKind ?? "api";
  const hasApiToken = apiToken.length > 0;
  const hasMcpBearer = mcpBearer.length > 0;

  if (kind === "api") {
    if (!hasApiToken) {
      throw new ProductionSafetyError(
        "NODE_ENV=production with a non-loopback API bind requires API_TOKEN. " +
          "MCP_HTTP_BEARER_TOKEN alone does not authorize the HTTP API (open-dev would remain enabled).",
      );
    }
    return;
  }

  if (!hasApiToken && !hasMcpBearer) {
    throw new ProductionSafetyError(
      "NODE_ENV=production with a non-loopback MCP HTTP bind requires API_TOKEN " +
        "or MCP_HTTP_BEARER_TOKEN. Open-dev is not allowed on exposed interfaces.",
    );
  }
}

/**
 * Parse CODEORACLE_ALLOWED_ROOTS (comma-separated absolute or relative roots).
 * Lexical resolve only — realpath happens in `assertLocalClonePathAllowed`.
 */
export function parseAllowedRoots(raw: string | readonly string[] | undefined): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((r) => resolve(String(r).trim())).filter((r) => r.length > 0);
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => resolve(s));
}

export class AllowedRootsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowedRootsError";
  }
}

function realpathOrThrow(label: string, path: string): string {
  try {
    return realpathSync(path);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AllowedRootsError(`cannot realpath ${label} ${path}: ${detail}`);
  }
}

function isPathUnderRoot(candidateReal: string, rootReal: string): boolean {
  return (
    candidateReal === rootReal ||
    candidateReal.startsWith(rootReal.endsWith(sep) ? rootReal : rootReal + sep)
  );
}

/**
 * Jail local clone/register paths under CODEORACLE_ALLOWED_ROOTS.
 * - roots empty + non-production → allow (dev ergonomics); returns realpath when possible
 * - roots empty + production → refuse (fail closed)
 * - roots set → both roots and candidate are `realpath`'d (blocks symlink escape), then
 *   path must equal a root or live under it
 */
export function assertLocalClonePathAllowed(
  localPath: string,
  allowedRoots: readonly string[],
  opts: { nodeEnv: Env["NODE_ENV"] },
): string {
  const absPath = resolve(localPath);

  if (allowedRoots.length === 0) {
    if (opts.nodeEnv === "production") {
      throw new AllowedRootsError(
        "CODEORACLE_ALLOWED_ROOTS must be set in production before registering or indexing local paths. " +
          "This is a clone-root jail — it does not replace the P0-A secret path denylist.",
      );
    }
    try {
      return realpathSync(absPath);
    } catch {
      return absPath;
    }
  }

  const realRoots = allowedRoots.map((root) => realpathOrThrow("allowed root", resolve(root)));
  const realPath = realpathOrThrow("local path", absPath);

  const underRoot = realRoots.some((rootReal) => isPathUnderRoot(realPath, rootReal));

  if (!underRoot) {
    throw new AllowedRootsError(
      `local path ${realPath} is outside CODEORACLE_ALLOWED_ROOTS ` +
        `(${realRoots.join(", ")}).`,
    );
  }

  return realPath;
}
