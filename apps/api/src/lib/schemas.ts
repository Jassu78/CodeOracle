export type RegisterRepoBody = {
  githubFullName?: string;
  branch?: string;
  localPath?: string;
  name?: string;
};

export function parseRegisterRepoBody(body: unknown): RegisterRepoBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "invalid body" };
  const b = body as Record<string, unknown>;
  const githubFullName = typeof b.githubFullName === "string" ? b.githubFullName : undefined;
  const localPath = typeof b.localPath === "string" ? b.localPath : undefined;
  if (!githubFullName && !localPath) return { error: "githubFullName or localPath required" };
  return {
    githubFullName,
    localPath,
    branch: typeof b.branch === "string" ? b.branch : undefined,
    name: typeof b.name === "string" ? b.name : undefined,
  };
}
