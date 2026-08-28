import { z } from "zod";

export const IndexStatus = z.enum(["pending", "indexing", "ready", "error"]);
export type IndexStatus = z.infer<typeof IndexStatus>;

export const RepoSchema = z.object({
  id: z.string().uuid(),
  githubFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "expected 'owner/name'"),
  defaultBranch: z.string().min(1),
  webhookSecretHash: z.string().min(1),
  lastFullIndexAt: z.string().datetime().nullable().default(null),
  lastIncrementalAt: z.string().datetime().nullable().default(null),
  indexStatus: IndexStatus.default("pending"),
  embeddingModelId: z.string().min(1).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const ApiTokenSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  tokenHash: z.string().min(1),
  lastUsedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type ApiToken = z.infer<typeof ApiTokenSchema>;
