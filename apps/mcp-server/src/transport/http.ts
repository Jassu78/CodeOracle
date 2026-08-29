/**
 * MCP Streamable HTTP transport (D5.3) — SSE-capable HTTP surface.
 * Auth + rate-limit live HERE only; tools stay in create-server.ts.
 *
 * Bearer rules (aligned with API H6):
 * - Missing/invalid → 401
 * - API_TOKEN → ok (admin)
 * - Per-repo api_tokens row → ok only when repoId === CODEORACLE_REPO_ID
 * - MCP_HTTP_BEARER_TOKEN → ok (dedicated MCP secret, optional)
 * - Open-dev (no API_TOKEN, no api_tokens, no MCP_HTTP_BEARER_TOKEN) → rejected
 *   on HTTP (remote surface must not be open; stdio remains local)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { apiTokens, verifyApiToken } from "@codeoracle/db";
import { checkRateLimit, clientKeyFromRequest, createRedisConnection } from "@codeoracle/queue";
import type { McpRuntime } from "../bootstrap.js";
import { mcpLog } from "../log.js";

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Pure bearer authorization for MCP HTTP (testable without DB/HTTP).
 */
export async function authorizeMcpBearerToken(opts: {
  token: string;
  repoId: string;
  apiToken?: string;
  mcpHttpBearerToken?: string;
  lookupRepoToken: (raw: string) => Promise<{ repoId: string } | null>;
}): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const { token, repoId, apiToken, mcpHttpBearerToken, lookupRepoToken } = opts;

  if (mcpHttpBearerToken && constantTimeEquals(token, mcpHttpBearerToken)) {
    return { ok: true };
  }
  if (apiToken && constantTimeEquals(token, apiToken)) {
    return { ok: true };
  }

  const row = await lookupRepoToken(token);
  if (row) {
    if (row.repoId !== repoId) {
      return { ok: false, status: 403, error: "token not scoped to this repository" };
    }
    return { ok: true };
  }

  return { ok: false, status: 401, error: "invalid bearer token" };
}

export async function verifyMcpHttpBearer(
  req: IncomingMessage,
  runtime: McpRuntime,
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const token = readBearer(req);
  if (!token) {
    return { ok: false, status: 401, error: "missing bearer token" };
  }

  return authorizeMcpBearerToken({
    token,
    repoId: runtime.repoId,
    apiToken: runtime.env.API_TOKEN,
    mcpHttpBearerToken: runtime.env.MCP_HTTP_BEARER_TOKEN,
    lookupRepoToken: (raw) => verifyApiToken(runtime.db, raw),
  });
}

/** True when at least one HTTP auth mechanism is configured. */
export async function mcpHttpAuthConfigured(runtime: McpRuntime): Promise<boolean> {
  if (runtime.env.MCP_HTTP_BEARER_TOKEN || runtime.env.API_TOKEN) return true;
  const rows = await runtime.db.select({ id: apiTokens.id }).from(apiTokens).limit(1);
  return rows.length > 0;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export type ListenHttpOpts = {
  runtime: McpRuntime;
  port: number;
  host?: string;
  /** Max MCP requests per client per window (default 60/min). */
  rateLimitPerMinute?: number;
};

/**
 * Start Streamable HTTP MCP on /mcp (POST/GET/DELETE).
 * Returns a close function.
 */
export async function listenHttp(opts: ListenHttpOpts): Promise<{ close: () => Promise<void> }> {
  const { runtime, port } = opts;
  const host = opts.host ?? "127.0.0.1";
  const rateLimit = opts.rateLimitPerMinute ?? 60;

  if (!(await mcpHttpAuthConfigured(runtime))) {
    throw new Error(
      "MCP HTTP requires auth: set API_TOKEN, MCP_HTTP_BEARER_TOKEN, or mint a per-repo token for CODEORACLE_REPO_ID. Open-dev is not allowed on the HTTP transport.",
    );
  }

  const redis = createRedisConnection(runtime.env.REDIS_URL);
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, transport: "streamable-http", repoId: runtime.repoId });
        return;
      }

      if (url.pathname !== "/mcp") {
        sendJson(res, 404, { error: "not found" });
        return;
      }

      const auth = await verifyMcpHttpBearer(req, runtime);
      if (!auth.ok) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="codeoracle-mcp"');
        sendJson(res, auth.status, { error: auth.error });
        return;
      }

      if (!(await checkRateLimit(redis, `mcp-http:${clientKeyFromRequest(req)}`, rateLimit, 60_000))) {
        sendJson(res, 429, { error: `rate limit exceeded — max ${rateLimit} requests per minute` });
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      const sessionHeader = typeof sessionId === "string" ? sessionId : undefined;

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        let transport = sessionHeader ? sessions.get(sessionHeader) : undefined;

        if (!transport && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
              sessions.set(sid, transport!);
            },
          });
          transport.onclose = () => {
            const sid = transport!.sessionId;
            if (sid) sessions.delete(sid);
          };
          const mcp = runtime.createServer();
          await mcp.connect(transport);
        }

        if (!transport) {
          sendJson(res, 400, { error: "missing or unknown mcp-session-id; send initialize first" });
          return;
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        if (!sessionHeader || !sessions.has(sessionHeader)) {
          sendJson(res, 400, { error: "missing or unknown mcp-session-id" });
          return;
        }
        const transport = sessions.get(sessionHeader)!;
        await transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 405, { error: "method not allowed" });
    } catch (err) {
      mcpLog("error", "MCP HTTP request failed", { err: (err as Error).message });
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  mcpLog("info", "MCP Streamable HTTP listening", {
    host,
    port,
    path: "/mcp",
    repoId: runtime.repoId,
    rateLimitPerMinute: rateLimit,
  });

  return {
    close: async () => {
      for (const t of sessions.values()) await t.close();
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await redis.quit();
    },
  };
}
