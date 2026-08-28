import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, loadProjectEnv } from "@codeoracle/config";
import { JOB_NAMES } from "@codeoracle/contracts";
import {
  createDb,
  getRepoById,
  registerGithubRepo,
  registerLocalRepo,
} from "@codeoracle/db";
import { createQueue, createRedisConnection, bullJobId } from "@codeoracle/queue";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}

async function main() {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/repos") {
        const body = await readJsonBody<{
          githubFullName?: string;
          branch?: string;
          localPath?: string;
          name?: string;
        }>(req);

        if (body.localPath) {
          const name = body.name ?? body.localPath.split("/").pop() ?? "repo";
          const { repoId } = await registerLocalRepo(db, {
            name,
            localClonePath: resolve(body.localPath),
            branch: body.branch,
          });
          sendJson(res, 201, { repoId, githubFullName: `local/${name}` });
          return;
        }

        if (!body.githubFullName) {
          sendJson(res, 400, { error: "githubFullName or localPath required" });
          return;
        }

        const { repoId } = await registerGithubRepo(db, {
          githubFullName: body.githubFullName,
          branch: body.branch ?? "main",
        });
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
        sendJson(res, 202, { queued: true, job: JOB_NAMES.FULL_INDEX });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(env.API_PORT, () => {
    console.log(`CodeOracle API listening on http://localhost:${env.API_PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
