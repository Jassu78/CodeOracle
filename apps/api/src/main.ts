import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv, assertProductionSafety, effectiveBindHost, assertLocalClonePathAllowed, parseAllowedRoots } from "@codeoracle/config";
import { JOB_NAMES, type IncrementalReindexJobPayload } from "@codeoracle/contracts";
import {
  closeDb,
  createApiToken,
  createDb,
  getRepoByGithubFullName,
  getRepoById,
  listApiTokens,
  registerGithubRepo,
  registerLocalRepo,
  revokeApiToken,
} from "@codeoracle/db";
import { createLogger } from "@codeoracle/observability";
import { createQueue, createRedisConnection, bullJobId, checkRateLimit, clientKeyFromRequest, safeReplaceJob } from "@codeoracle/queue";
import {
  authorizeAdmin,
  authorizeForRepo,
  forbiddenBody,
  isOpenDevAuth,
  resolveAuth,
  unauthorizedBody,
} from "./lib/auth.js";
import { checkDeepHealth } from "./lib/health.js";
import { parseRegisterRepoBody } from "./lib/schemas.js";
import { handleGithubWebhook } from "./webhooks/handle-github-push.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const log = createLogger("api");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(req);
  if (!raw.toString("utf8").trim()) return {};
  return JSON.parse(raw.toString("utf8")) as unknown;
}

function isDuplicateJobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|duplicat/i.test(msg);
}

async function main() {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  assertProductionSafety(env, {
    bindHosts: [effectiveBindHost(env.API_HOST)],
    bindKind: "api",
  });
  const allowedRoots = parseAllowedRoots(env.CODEORACLE_ALLOWED_ROOTS);
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  // One Redis connection + one BullMQ Queue for the whole process lifetime —
  // reused by every request instead of opening/closing a fresh connection
  // per webhook delivery or index trigger (that pattern doesn't scale past
  // a handful of requests and risks exhausting Redis's max-clients under
  // any real burst). Mirrors createDb's per-process pooling.
  const redis = createRedisConnection(env.REDIS_URL);
  const queue = createQueue(redis);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        const health = await checkDeepHealth(env, redis);
        sendJson(res, health.ok ? 200 : 503, health);
        return;
      }

      // GitHub webhooks use HMAC, not API_TOKEN bearer.
      if (req.method === "POST" && url.pathname === "/webhooks/github") {
        const rawBody = await readRawBody(req);
        const result = await handleGithubWebhook({
          rawBody,
          signatureHeader: headerString(req.headers["x-hub-signature-256"]),
          eventHeader: headerString(req.headers["x-github-event"]),
          deps: {
            verifySecret: env.GITHUB_WEBHOOK_SECRET ?? "",
            findRepoByFullName: async (githubFullName) => {
              const row = await getRepoByGithubFullName(db, githubFullName);
              if (!row) return null;
              return {
                id: row.id,
                githubFullName: row.githubFullName,
                indexStatus: row.indexStatus,
              };
            },
            enqueueIncremental: async ({ jobId, payload }) => {
              try {
                await queue.add(JOB_NAMES.INCREMENTAL_REINDEX, payload satisfies IncrementalReindexJobPayload, {
                  jobId,
                  removeOnComplete: 100,
                  removeOnFail: 500,
                  attempts: 3,
                  backoff: { type: "exponential", delay: 5000 },
                });
                return "queued";
              } catch (err) {
                if (isDuplicateJobError(err)) return "duplicate";
                throw err;
              }
            },
          },
        });

        log.info("GitHub webhook handled", {
          status: result.httpStatus,
          body: result.body,
        });
        sendJson(res, result.httpStatus, result.body);
        return;
      }

      const openDev = await isOpenDevAuth(env, db);
      const principal = await resolveAuth(req, env, db);

      // Every non-health, non-webhook route requires a principal unless open-dev.
      if (!openDev && !principal) {
        sendJson(res, 401, unauthorizedBody());
        return;
      }

      if (req.method === "POST" && url.pathname === "/repos") {
        if (!authorizeAdmin(principal, openDev)) {
          sendJson(res, 403, forbiddenBody());
          return;
        }
        const parsed = parseRegisterRepoBody(await readJsonBody(req));
        if ("error" in parsed) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }
        const body = parsed;

        if (body.localPath) {
          const name = body.name ?? body.localPath.split("/").pop() ?? "repo";
          let localClonePath: string;
          try {
            localClonePath = assertLocalClonePathAllowed(body.localPath, allowedRoots, {
              nodeEnv: env.NODE_ENV,
            });
          } catch (err) {
            sendJson(res, 400, { error: (err as Error).message });
            return;
          }
          const { repoId } = await registerLocalRepo(db, {
            name,
            localClonePath,
            branch: body.branch,
          });
          log.info("Registered local repo", { repoId, name });
          sendJson(res, 201, { repoId, githubFullName: `local/${name}` });
          return;
        }

        const { repoId } = await registerGithubRepo(db, {
          githubFullName: body.githubFullName!,
          branch: body.branch ?? "main",
        });
        log.info("Registered github repo", { repoId, githubFullName: body.githubFullName });
        sendJson(res, 201, { repoId, githubFullName: body.githubFullName });
        return;
      }

      const repoMatch = url.pathname.match(/^\/repos\/([0-9a-f-]{36})$/);
      if (req.method === "GET" && repoMatch) {
        const repoId = repoMatch[1]!;
        if (!authorizeForRepo(principal, repoId, openDev)) {
          sendJson(res, 403, forbiddenBody());
          return;
        }
        const row = await getRepoById(db, repoId);
        if (!row) {
          sendJson(res, 404, { error: "repo not found" });
          return;
        }
        sendJson(res, 200, row);
        return;
      }

      const indexMatch = url.pathname.match(/^\/repos\/([0-9a-f-]{36})\/index$/);
      if (req.method === "POST" && indexMatch) {
        const repoId = indexMatch[1]!;
        if (!authorizeForRepo(principal, repoId, openDev)) {
          sendJson(res, 403, forbiddenBody());
          return;
        }
        if (!(await checkRateLimit(redis, `index:${clientKeyFromRequest(req)}`, 10, 60_000))) {
          sendJson(res, 429, { error: "rate limit exceeded — max 10 index requests per minute" });
          return;
        }

        const row = await getRepoById(db, repoId);
        if (!row) {
          sendJson(res, 404, { error: "repo not found" });
          return;
        }

        const fullIndexJobId = bullJobId("full_index", repoId);
        const replace = await safeReplaceJob({
          queue,
          name: JOB_NAMES.FULL_INDEX,
          jobId: fullIndexJobId,
          data: {
            repoId,
            githubFullName: row.githubFullName,
            branch: row.defaultBranch,
          },
          jobOpts: {
            removeOnComplete: 100,
            removeOnFail: 500,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        });
        if (replace === "skipped_active") {
          log.info("full_index already active", { repoId, jobId: fullIndexJobId });
          sendJson(res, 202, {
            queued: false,
            alreadyIndexing: true,
            job: JOB_NAMES.FULL_INDEX,
            jobId: fullIndexJobId,
          });
          return;
        }
        log.info("Queued full_index", { repoId, jobId: fullIndexJobId, replace });
        sendJson(res, 202, { queued: true, job: JOB_NAMES.FULL_INDEX, jobId: fullIndexJobId });
        return;
      }

      // Per-repo bearer token lifecycle — minting requires admin or open-dev
      // (a repo token must not mint additional tokens for privilege escalation).
      // List/revoke require authorizeForRepo (admin or that repo's token).
      const tokensMatch = url.pathname.match(/^\/repos\/([0-9a-f-]{36})\/tokens$/);
      if (req.method === "POST" && tokensMatch) {
        const repoId = tokensMatch[1]!;
        if (!authorizeAdmin(principal, openDev)) {
          sendJson(res, 403, {
            error: "forbidden — only API_TOKEN (admin) or open-dev may mint repo tokens",
          });
          return;
        }
        const row = await getRepoById(db, repoId);
        if (!row) {
          sendJson(res, 404, { error: "repo not found" });
          return;
        }
        const { id, token } = await createApiToken(db, { repoId });
        log.info("Issued API token", { repoId, tokenId: id });
        sendJson(res, 201, { id, token, warning: "shown once — store it now" });
        return;
      }

      if (req.method === "GET" && tokensMatch) {
        const repoId = tokensMatch[1]!;
        if (!authorizeForRepo(principal, repoId, openDev)) {
          sendJson(res, 403, forbiddenBody());
          return;
        }
        const tokens = await listApiTokens(db, repoId);
        sendJson(res, 200, { tokens });
        return;
      }

      const revokeMatch = url.pathname.match(/^\/repos\/([0-9a-f-]{36})\/tokens\/([0-9a-f-]{36})$/);
      if (req.method === "DELETE" && revokeMatch) {
        const [, repoId, tokenId] = revokeMatch as unknown as [string, string, string];
        if (!authorizeForRepo(principal, repoId, openDev)) {
          sendJson(res, 403, forbiddenBody());
          return;
        }
        const revoked = await revokeApiToken(db, { repoId, tokenId });
        if (!revoked) {
          sendJson(res, 404, { error: "token not found for this repo" });
          return;
        }
        log.info("Revoked API token", { repoId, tokenId });
        sendJson(res, 200, { revoked: true });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      log.error("Request failed", { err: (err as Error).message });
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  const listenHost = env.API_HOST?.trim() || undefined;
  server.listen(env.API_PORT, listenHost, () => {
    log.info("API listening", {
      host: listenHost ?? "0.0.0.0",
      port: env.API_PORT,
      auth: Boolean(env.API_TOKEN),
      githubWebhook: Boolean(env.GITHUB_WEBHOOK_SECRET),
    });
  });

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down`, {});
    server.close();
    await queue.close();
    await redis.quit();
    await closeDb(env.DATABASE_URL);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
