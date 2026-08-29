import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { repos } from "../schema/repos.js";

export async function registerGithubRepo(
  db: Database,
  opts: {
    githubFullName: string;
    branch: string;
  },
): Promise<{ repoId: string }> {
  const webhookSecretHash = createHash("sha256").update(randomUUID()).digest("hex");

  const existing = await db
    .select()
    .from(repos)
    .where(eq(repos.githubFullName, opts.githubFullName))
    .limit(1);

  if (existing[0]) {
    return { repoId: existing[0].id };
  }

  const repoId = randomUUID();
  await db.insert(repos).values({
    id: repoId,
    githubFullName: opts.githubFullName,
    defaultBranch: opts.branch,
    webhookSecretHash,
    indexStatus: "pending",
  });
  return { repoId };
}

export async function registerLocalRepo(
  db: Database,
  opts: {
    name: string;
    localClonePath: string;
    branch?: string;
  },
): Promise<{ repoId: string }> {
  const githubFullName = `local/${opts.name}`;
  const absPath = resolve(opts.localClonePath);
  const webhookSecretHash = createHash("sha256").update(randomUUID()).digest("hex");

  const existing = await db
    .select()
    .from(repos)
    .where(eq(repos.githubFullName, githubFullName))
    .limit(1);

  if (existing[0]) {
    await db
      .update(repos)
      .set({ localClonePath: absPath, defaultBranch: opts.branch ?? existing[0].defaultBranch })
      .where(eq(repos.id, existing[0].id));
    return { repoId: existing[0].id };
  }

  const repoId = randomUUID();
  await db.insert(repos).values({
    id: repoId,
    githubFullName,
    defaultBranch: opts.branch ?? "main",
    webhookSecretHash,
    localClonePath: absPath,
    indexStatus: "pending",
  });
  return { repoId };
}

export async function getRepoById(db: Database, repoId: string) {
  const [row] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
  return row ?? null;
}

export async function getRepoByGithubFullName(db: Database, githubFullName: string) {
  const [row] = await db
    .select()
    .from(repos)
    .where(eq(repos.githubFullName, githubFullName))
    .limit(1);
  return row ?? null;
}
