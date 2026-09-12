import { describe, expect, it, vi, afterEach } from "vitest";
import type { RerankEndpoint } from "@codeoracle/contracts";
import { ProviderRequestError } from "../src/openai-compat-adapter.js";
import { TeiRerankAdapter } from "../src/tei-rerank-adapter.js";

const endpoint: RerankEndpoint = {
  id: "tei-local",
  protocol: "tei",
  baseUrl: "http://tei.example",
  apiKeyEnv: null,
  model: "BAAI/bge-reranker-base",
  priority: 1,
  enabled: true,
};

const candidates = [
  { id: "a", text: "alpha chunk" },
  { id: "b", text: "beta chunk" },
  { id: "c", text: "gamma chunk" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TeiRerankAdapter", () => {
  it("maps shuffled TEI indices back to candidate ids and sorts by score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { index: 2, score: 0.9 },
          { index: 0, score: 0.5 },
          { index: 1, score: 0.1 },
        ]),
      ),
    );

    const adapter = new TeiRerankAdapter(endpoint, null);
    const hits = await adapter.rerank("q", candidates, AbortSignal.timeout(1_000));
    expect(hits.map((h) => h.id)).toEqual(["c", "a", "b"]);
    expect(hits[0]?.score).toBe(0.9);
  });

  it("ignores out-of-range indices and non-finite scores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { index: 99, score: 1 },
          { index: 1, score: Number.NaN },
          { index: 0, score: 0.7 },
        ]),
      ),
    );

    const adapter = new TeiRerankAdapter(endpoint, null);
    const hits = await adapter.rerank("q", candidates, AbortSignal.timeout(1_000));
    expect(hits).toEqual([{ id: "a", score: 0.7 }]);
  });

  it("short-circuits empty candidates without HTTP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TeiRerankAdapter(endpoint, null);
    await expect(adapter.rerank("q", [], AbortSignal.timeout(1_000))).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws status-only errors without response body text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("SECRET_QUERY_LEAK in body", { status: 503 })),
    );

    const adapter = new TeiRerankAdapter(endpoint, null);
    await expect(adapter.rerank("q", candidates, AbortSignal.timeout(1_000))).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ProviderRequestError &&
        err.status === 503 &&
        !err.message.includes("SECRET_QUERY_LEAK"),
    );
  });

  it("posts to /rerank with truncate and optional bearer", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe("http://tei.example/rerank");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer tok",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        texts: string[];
        truncate: boolean;
      };
      expect(body.query).toBe("auth");
      expect(body.texts).toEqual(["alpha chunk", "beta chunk", "gamma chunk"]);
      expect(body.truncate).toBe(true);
      return Response.json([{ index: 0, score: 1 }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new TeiRerankAdapter(endpoint, "tok");
    await adapter.rerank("auth", candidates, AbortSignal.timeout(1_000));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
