import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { apiTokens } from "../schema/api-tokens.js";

const TOKEN_PREFIX = "co_";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Creates a new per-repo bearer token. The raw token is returned exactly
 * once — only its SHA-256 hash is ever persisted, matching the schema's own
 * documented contract ("shown once at creation, never persisted in plaintext").
 */
export async function createApiToken(
  db: Database,
  opts: { repoId: string },
): Promise<{ id: string; token: string }> {
  const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(raw);

  const [row] = await db
    .insert(apiTokens)
    .values({ repoId: opts.repoId, tokenHash })
    .returning({ id: apiTokens.id });

  return { id: row!.id, token: raw };
}

export type ApiTokenSummary = {
  id: string;
  repoId: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export async function listApiTokens(db: Database, repoId: string): Promise<ApiTokenSummary[]> {
  const rows = await db
    .select({
      id: apiTokens.id,
      repoId: apiTokens.repoId,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.repoId, repoId));
  return rows;
}

/** Returns true if a token existed and was deleted. */
export async function revokeApiToken(
  db: Database,
  opts: { repoId: string; tokenId: string },
): Promise<boolean> {
  const deleted = await db
    .delete(apiTokens)
    .where(eq(apiTokens.id, opts.tokenId))
    .returning({ id: apiTokens.id, repoId: apiTokens.repoId });
  return deleted.length > 0 && deleted[0]!.repoId === opts.repoId;
}

/**
 * Verifies a raw bearer token against stored hashes and, if valid, records
 * `lastUsedAt`. Constant-time-safe by construction: SHA-256 hash equality is
 * a Postgres index lookup, not a string comparison of the secret itself.
 */
export async function verifyApiToken(
  db: Database,
  rawToken: string,
): Promise<{ id: string; repoId: string } | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);

  const [row] = await db
    .select({ id: apiTokens.id, repoId: apiTokens.repoId })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;

  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return row;
}
