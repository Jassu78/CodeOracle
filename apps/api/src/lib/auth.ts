import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Env } from "@codeoracle/config";
import { apiTokens, verifyApiToken, type Database } from "@codeoracle/db";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authenticated caller. `admin` is the process-wide `API_TOKEN`.
 * `repo` is a hashed per-repo token bound to exactly one `repoId` (H6).
 */
export type AuthPrincipal =
  | { kind: "admin" }
  | { kind: "repo"; repoId: string; tokenId: string };

/**
 * Resolve the bearer to a principal, or null if missing/invalid.
 * Does not apply open-dev fallback — callers use `isOpenDevAuth`.
 */
export async function resolveAuth(
  req: IncomingMessage,
  env: Env,
  db: Database,
): Promise<AuthPrincipal | null> {
  const token = bearerToken(req);
  if (!token) return null;

  if (env.API_TOKEN && constantTimeEquals(token, env.API_TOKEN)) {
    return { kind: "admin" };
  }

  const row = await verifyApiToken(db, token);
  if (row) return { kind: "repo", repoId: row.repoId, tokenId: row.id };

  return null;
}

/** True when no auth mechanism is configured — local-dev open mode. */
export async function isOpenDevAuth(env: Env, db: Database): Promise<boolean> {
  if (env.API_TOKEN) return false;
  const rows = await db.select({ id: apiTokens.id }).from(apiTokens).limit(1);
  return rows.length === 0;
}

/**
 * Authorize access to a specific repo.
 * - admin → any repo
 * - repo token → only its minting repoId
 * - open-dev (no principal, openDev=true) → allow
 */
export function authorizeForRepo(
  principal: AuthPrincipal | null,
  repoId: string,
  openDev: boolean,
): boolean {
  if (openDev && !principal) return true;
  if (!principal) return false;
  if (principal.kind === "admin") return true;
  return principal.repoId === repoId;
}

/** Global admin actions (e.g. POST /repos register) — admin or open-dev only. */
export function authorizeAdmin(principal: AuthPrincipal | null, openDev: boolean): boolean {
  if (openDev && !principal) return true;
  return principal?.kind === "admin";
}

/**
 * @deprecated Prefer resolveAuth + authorizeForRepo. Kept for call sites mid-migration.
 * Unscoped: any valid token (or open-dev) returns true — does NOT enforce H6.
 */
export async function isAuthorized(req: IncomingMessage, env: Env, db: Database): Promise<boolean> {
  const openDev = await isOpenDevAuth(env, db);
  if (openDev) return true;
  return (await resolveAuth(req, env, db)) !== null;
}

export function unauthorizedBody(): { error: string } {
  return { error: "unauthorized — set Authorization: Bearer <API_TOKEN or per-repo token>" };
}

export function forbiddenBody(): { error: string } {
  return { error: "forbidden — token is not scoped to this repository" };
}
