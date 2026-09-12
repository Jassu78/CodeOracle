import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { ProviderRegistry, resetSharedCircuitBreaker } from "../src/provider-registry.js";
import { createSearchRerankFn } from "../src/search-rerank.js";

const rerankConfig: ProvidersConfig = {
  chat: [],
  embeddings: [],
  rerank: [
    {
      id: "tei-a",
      protocol: "tei",
      baseUrl: "http://tei-a.example",
      apiKeyEnv: null,
      model: "BAAI/bge-reranker-base",
      priority: 1,
      enabled: true,
    },
    {
      id: "tei-b",
      protocol: "tei",
      baseUrl: "http://tei-b.example",
      apiKeyEnv: null,
      model: "BAAI/bge-reranker-base",
      priority: 2,
      enabled: true,
    },
  ],
};

describe("ProviderRegistry.rerank + createSearchRerankFn", () => {
  beforeEach(() => {
    resetSharedCircuitBreaker();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reranks via TEI and emits usage kind rerank", async () => {
    const usage: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          { index: 1, score: 0.95 },
          { index: 0, score: 0.1 },
        ]),
      ),
    );

    const registry = new ProviderRegistry({
      config: rerankConfig,
      onUsage: (e) => usage.push(e),
    });

    const result = await registry.rerank(
      "q",
      [
        { id: "x", text: "first" },
        { id: "y", text: "second" },
      ],
      { timeoutMs: 500 },
    );

    expect(result.providerId).toBe("tei-a");
    expect(result.results.map((r) => r.id)).toEqual(["y", "x"]);
    expect(usage).toEqual([
      expect.objectContaining({ providerId: "tei-a", kind: "rerank", success: true }),
    ]);
  });

  it("failovers to next TEI on retryable error within budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("tei-a.example")) {
          return new Response("busy", { status: 503 });
        }
        return Response.json([{ index: 0, score: 1 }]);
      }),
    );

    const registry = new ProviderRegistry({ config: rerankConfig });
    const result = await registry.rerank("q", [{ id: "only", text: "t" }], { timeoutMs: 2_000 });
    expect(result.providerId).toBe("tei-b");
  });

  it("createSearchRerankFn is undefined when disabled or no endpoints", () => {
    const registry = new ProviderRegistry({ config: rerankConfig });
    expect(
      createSearchRerankFn(registry, rerankConfig, { enabled: false, timeoutMs: 400 }),
    ).toBeUndefined();
    expect(
      createSearchRerankFn(
        registry,
        { ...rerankConfig, rerank: [] },
        { enabled: true, timeoutMs: 400 },
      ),
    ).toBeUndefined();
  });

  it("createSearchRerankFn returns results when enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ index: 0, score: 0.5 }])),
    );
    const registry = new ProviderRegistry({ config: rerankConfig });
    const fn = createSearchRerankFn(registry, rerankConfig, {
      enabled: true,
      timeoutMs: 400,
    });
    expect(fn).toBeTypeOf("function");
    const hits = await fn!("q", [{ id: "z", text: "t" }]);
    expect(hits).toEqual([{ id: "z", score: 0.5 }]);
  });

  it("aborts fetch within timeoutMs budget (not chat 90s)", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        observedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing AbortSignal"));
            return;
          }
          if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }),
    );

    const registry = new ProviderRegistry({
      config: {
        chat: [],
        embeddings: [],
        rerank: [rerankConfig.rerank[0]!],
      },
    });

    const started = Date.now();
    await expect(
      registry.rerank("q", [{ id: "z", text: "t" }], { timeoutMs: 40 }),
    ).rejects.toThrow(/timed out|aborted/i);
    expect(Date.now() - started).toBeLessThan(500);
    expect(observedSignal).toBeDefined();
  });
});
