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

        // Deterministic, always-valid DecisionExtractionBatch. touchedPaths is
        // intentionally empty — extract-decisions.ts overwrites it with
        // deterministic git-derived paths when available (real code path),
        // so the fake LLM does not need to invent file paths.
        const decision = {
          topic: "Introduce local cache layer for repeated lookups",
          summary:
            "Added an in-memory cache in front of the lookup function to avoid recomputing the same result on every call.",
          alternativesConsidered: ["No caching (baseline)", "External Redis cache"],
          confidence: 0.9,
          touchedPaths: [],
        };
        const content = JSON.stringify({ decisions: [decision] });

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
