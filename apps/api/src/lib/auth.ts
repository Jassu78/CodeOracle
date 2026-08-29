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

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

/**
 * Two token classes, both real (no unused schema):
 *  - `API_TOKEN` env var — single admin/bootstrap token, constant-time compared.
 *  - Per-repo tokens in `api_tokens` (see `createApiToken`) — hash-looked-up
 *    in Postgres; presence of any valid, non-revoked token authorizes admin
 *    routes today (routes aren't yet scoped per-repo — see apps/api/README.md).
 *
 * If neither `API_TOKEN` nor any `api_tokens` row exists, auth is open
 * (local dev default, unchanged from before).
 */
export async function isAuthorized(req: IncomingMessage, env: Env, db: Database): Promise<boolean> {
  const token = bearerToken(req);

  if (env.API_TOKEN) {
    if (token && constantTimeEquals(token, env.API_TOKEN)) return true;
  }

  if (token) {
    const row = await verifyApiToken(db, token);
    if (row) return true;
  }

  // Open by default only when no token mechanism is configured at all.
  return !env.API_TOKEN && (await hasNoApiTokens(db));
}

async function hasNoApiTokens(db: Database): Promise<boolean> {
  // Cheap existence check via a 1-row probe rather than a count() scan.
  const rows = await db.select({ id: apiTokens.id }).from(apiTokens).limit(1);
  return rows.length === 0;
}

export function unauthorizedBody(): { error: string } {
  return { error: "unauthorized — set Authorization: Bearer <API_TOKEN or per-repo token>" };
}
