import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Minimal OpenAI-compatible `/v1/embeddings` + `/v1/chat/completions` server
 * for CI integration tests — deterministic, ₹0, no network egress. This is
 * what makes the full index→embed→extract→retrieval pipeline testable in
 * CI without Ollama/Gemini/Groq/OpenRouter, matching D5.1's "no network
 * dependency" requirement for the fixture-repo eval gate.
 */
const EMBED_DIM = 32;
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]+/g;

function bucketIndex(token: string): number {
  const hash = createHash("sha256").update(token).digest();
  return hash.readUInt32BE(0) % EMBED_DIM;
}

/**
 * Deterministic bag-of-words vector — NOT a semantic embedding, but unlike
 * a plain per-string hash, two texts that share vocabulary ("cache" query
 * vs. a decision summary that mentions "cache") land nearer each other in
 * cosine space, which is what the real Qdrant score-threshold search over
 * find_decision/search_codebase actually needs to return non-empty results
 * in a deterministic CI test.
 */
function deterministicVector(text: string): number[] {
  const vector = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(TOKEN_RE) ?? [];
  for (const token of tokens) {
    if (token.length < 2) continue;
    const idx = bucketIndex(token);
    vector[idx] = (vector[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function decisionFromSourceText(blob: string): {
  topic: string;
  summary: string;
  alternativesConsidered: string[];
  confidence: number;
  touchedPaths: string[];
} | null {
  const lower = blob.toLowerCase();
  // Prefer empty over inventing WHY when the source has no rationale cues.
  if (!/\b(instead of|rather than|so that|because|without|prefer|fail)\b/i.test(blob)) {
    return null;
  }

  if (/\bcookie|session\b/.test(lower) && /memory|restart|redis/i.test(lower)) {
    return {
      topic: "Signed-cookie session store",
      summary:
        "Use signed cookies for session state instead of an in-memory server Map so sessions survive process restarts without Redis.",
      alternativesConsidered: ["In-memory server Map", "Redis-backed sessions"],
      confidence: 0.9,
      touchedPaths: [],
    };
  }
  if (/\bcache\b/.test(lower) && /redis|map|memory/i.test(lower)) {
    return {
      topic: "Process-local in-memory lookup cache",
      summary:
        "Cache expensive lookup results in a process-local Map rather than Redis for the single-process ₹0 MVP path.",
      alternativesConsidered: ["No caching", "External Redis cache"],
      confidence: 0.9,
      touchedPaths: [],
    };
  }
  if (/\bpool\b/.test(lower) && /postgres|connection/i.test(lower)) {
    return {
      topic: "Capped Postgres connection pool",
      summary:
        "Cap pool size explicitly so MCP tool bursts cannot open unbounded Postgres connections; fail loud instead.",
      alternativesConsidered: ["Unbounded pool", "Single shared client"],
      confidence: 0.88,
      touchedPaths: [],
    };
  }
  if (/\bbearer\b/.test(lower) && /empty|blank|reject|fail/i.test(lower)) {
    return {
      topic: "Reject empty bearer tokens",
      summary:
        "Fail closed when Authorization is present but empty — never treat a blank bearer as anonymous open access.",
      alternativesConsidered: ["Treat empty bearer as anonymous", "Soft-warn only"],
      confidence: 0.9,
      touchedPaths: [],
    };
  }
  if (/\bhealth\b/.test(lower) && /cache|pool/i.test(lower)) {
    return {
      topic: "Health exposes cache and pool stats",
      summary:
        "Expose cache size and configured pool max on /health so operators can observe process-local cache growth.",
      alternativesConsidered: ["Debugger-only inspection"],
      confidence: 0.85,
      touchedPaths: [],
    };
  }

  return {
    topic: "Architectural choice from commit rationale",
    summary: blob.split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 400),
    alternativesConsidered: [],
    confidence: 0.7,
    touchedPaths: [],
  };
}

export type FakeProviderServer = {
  baseUrl: string;
  /** Chat completions received so far — useful for asserting prompt shape. */
  chatCalls: Array<{ system: string; user: string }>;
  stop: () => Promise<void>;
};

export async function startFakeProviderServer(): Promise<FakeProviderServer> {
  const chatCalls: FakeProviderServer["chatCalls"] = [];

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = req.url ?? "";

      if (req.method === "POST" && url.endsWith("/embeddings")) {
        const body = (await readJsonBody(req)) as { input: string[] };
        const data = body.input.map((text) => ({ embedding: deterministicVector(text) }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
        return;
      }

      if (req.method === "POST" && url.endsWith("/chat/completions")) {
        const body = (await readJsonBody(req)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const system = body.messages.find((m) => m.role === "system")?.content ?? "";
        const user = body.messages.find((m) => m.role === "user")?.content ?? "";
        chatCalls.push({ system, user });

        // Derive a deterministic Decision from the extraction user prompt so
        // multi-commit fixtures produce distinct, retrievable decisions
        // (title/body are embedded in buildExtractionUserPrompt).
        const title = (user.match(/^Title:\s*(.+)$/m)?.[1] ?? "").trim();
        const bodyBlock = user.includes("Body:\n")
          ? user.slice(user.indexOf("Body:\n") + "Body:\n".length).split("\nReminder:")[0] ?? ""
          : "";
        const blob = `${title}\n${bodyBlock}`;

        const decision = decisionFromSourceText(blob);
        const content = JSON.stringify({
          decisions: decision ? [decision] : [],
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { total_tokens: content.length },
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    chatCalls,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
