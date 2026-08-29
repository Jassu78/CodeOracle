import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { JOB_NAMES, type IncrementalReindexJobPayload } from "@codeoracle/contracts";
import {
  createDb,
  getRepoByGithubFullName,
  getRepoById,
  registerGithubRepo,
  registerLocalRepo,
} from "@codeoracle/db";
import { createLogger } from "@codeoracle/observability";
import { createQueue, createRedisConnection, bullJobId } from "@codeoracle/queue";
import { isAuthorized, unauthorizedBody } from "./lib/auth.js";
import { checkDeepHealth } from "./lib/health.js";
import { checkRateLimit, clientKey } from "./lib/rate-limit.js";
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
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        const health = await checkDeepHealth(env);
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
              const connection = createRedisConnection(env.REDIS_URL);
              const queue = createQueue(connection);
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
              } finally {
                await queue.close();
                await connection.quit();
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

      if (req.method !== "GET" && !isAuthorized(req, env)) {
        sendJson(res, 401, unauthorizedBody());
        return;
      }

      if (req.method === "POST" && url.pathname === "/repos") {
        const parsed = parseRegisterRepoBody(await readJsonBody(req));
        if ("error" in parsed) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }
        const body = parsed;

        if (body.localPath) {
          const name = body.name ?? body.localPath.split("/").pop() ?? "repo";
          const { repoId } = await registerLocalRepo(db, {
            name,
            localClonePath: resolve(body.localPath),
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
        if (!checkRateLimit(`index:${clientKey(req)}`, 10, 60_000)) {
          sendJson(res, 429, { error: "rate limit exceeded — max 10 index requests per minute" });
          return;
        }

        const repoId = indexMatch[1]!;
        const row = await getRepoById(db, repoId);
        if (!row) {
          sendJson(res, 404, { error: "repo not found" });
          return;
        }

        const connection = createRedisConnection(env.REDIS_URL);
        const queue = createQueue(connection);
        const indexRunId = randomUUID();
        await queue.add(
          JOB_NAMES.FULL_INDEX,
          {
            repoId,
            githubFullName: row.githubFullName,
            branch: row.defaultBranch,
          },
          {
            jobId: bullJobId("full_index", repoId, indexRunId),
            removeOnComplete: 100,
            removeOnFail: 500,
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
        await queue.close();
        await connection.quit();
        log.info("Queued full_index", { repoId });
        sendJson(res, 202, { queued: true, job: JOB_NAMES.FULL_INDEX });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      log.error("Request failed", { err: (err as Error).message });
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(env.API_PORT, () => {
    log.info("API listening", {
      port: env.API_PORT,
      auth: Boolean(env.API_TOKEN),
      githubWebhook: Boolean(env.GITHUB_WEBHOOK_SECRET),
    });
  });
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
