import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ProvidersConfig } from "@codeoracle/contracts";
import { ProviderRegistry, resetSharedCircuitBreaker } from "../src/provider-registry.js";

const testConfig: ProvidersConfig = {
  chat: [
    {
      id: "primary-chat",
      kind: "chat",
      baseUrl: "https://primary.example/v1",
      apiKeyEnv: "PRIMARY_KEY",
      model: "model-a",
      priority: 1,
      enabled: true,
    },
    {
      id: "fallback-chat",
      kind: "chat",
      baseUrl: "https://fallback.example/v1",
      apiKeyEnv: null,
      model: "model-b",
      priority: 2,
      enabled: true,
    },
  ],
  embeddings: [
    {
      id: "embed-local",
      kind: "embeddings",
      baseUrl: "https://embed.example/v1",
      apiKeyEnv: null,
      model: "nomic-embed-text",
      priority: 1,
      enabled: true,
    },
  ],
  rerank: [],
};

describe("ProviderRegistry", () => {
  const env = { PRIMARY_KEY: "secret" };

  beforeEach(() => {
    resetSharedCircuitBreaker();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("primary.example")) {
          return new Response("rate limited", { status: 429 });
        }
        if (url.includes("fallback.example")) {
          return Response.json({
            choices: [{ message: { content: '{"decisions":[]}' } }],
            usage: { total_tokens: 42 },
          });
        }
        if (url.includes("embed.example")) {
          return Response.json({
            data: [{ embedding: [0.1, 0.2] }],
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("failovers chat from primary to fallback on 429", async () => {
    const usage: unknown[] = [];
    const registry = new ProviderRegistry({
      config: testConfig,
      env,
      onUsage: (e) => usage.push(e),
    });

    const result = await registry.complete("system", "user");
    expect(result.providerId).toBe("fallback-chat");
    expect(result.content).toContain("decisions");
    expect(result.tokensUsed).toBe(42);

    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ providerId: "primary-chat", success: false, kind: "chat" });
    expect(usage[1]).toMatchObject({ providerId: "fallback-chat", success: true, kind: "chat" });
  });

  it("failovers chat from primary to fallback on non-retryable 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("primary.example")) {
          return new Response("unauthorized", { status: 401 });
        }
        if (url.includes("fallback.example")) {
          return Response.json({
            choices: [{ message: { content: '{"decisions":[]}' } }],
            usage: { total_tokens: 10 },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const registry = new ProviderRegistry({ config: testConfig, env });
    const result = await registry.complete("system", "user");
    expect(result.providerId).toBe("fallback-chat");
  });

  it("returns primaryChatModelId from lowest priority enabled endpoint", () => {
    const registry = new ProviderRegistry({ config: testConfig, env });
    expect(registry.primaryChatModelId()).toBe("primary-chat:model-a");
    expect(registry.primaryEmbeddingModelId()).toBe("embed-local:nomic-embed-text");
  });

  it("throws when chat API key is missing for keyed endpoint", async () => {
    const registry = new ProviderRegistry({
      config: {
        chat: [testConfig.chat[0]!],
        embeddings: [],
        rerank: [],
      },
      env: {},
    });

    await expect(registry.complete("s", "u")).rejects.toThrow();
  });

  it("embeds via configured endpoint", async () => {
    const registry = new ProviderRegistry({ config: testConfig, env });
    const result = await registry.embed(["hello"]);
    expect(result.vectors).toHaveLength(1);
    expect(result.providerId).toBe("embed-local");
  });

  it("opens circuit after repeated 429s and skips that provider", async () => {
    let primaryHits = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("primary.example")) {
          primaryHits += 1;
          return new Response("rate limited", { status: 429 });
        }
        if (url.includes("fallback.example")) {
          return Response.json({
            choices: [{ message: { content: '{"decisions":[]}' } }],
            usage: { total_tokens: 1 },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    let now = 1_000;
    const registry = new ProviderRegistry({
      config: testConfig,
      env,
      circuitBreaker: { failureThreshold: 2, cooldownMs: 60_000, now: () => now },
    });

    await registry.complete("s", "u"); // 429 #1 → fallback
    await registry.complete("s", "u"); // 429 #2 → opens circuit, fallback
    expect(primaryHits).toBe(2);

    await registry.complete("s", "u"); // primary skipped while open
    expect(primaryHits).toBe(2);

    now += 61_000; // cool-down expired → half-open probe
    await registry.complete("s", "u");
    expect(primaryHits).toBe(3);
  });
});
