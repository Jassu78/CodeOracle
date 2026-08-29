import { describe, expect, it, vi } from "vitest";
import {
  checkExtractTokenBudget,
  extractTokenBudgetKey,
  recordExtractTokens,
} from "../src/lib/extract-token-budget.js";

function fakeRedis(store: Map<string, string>) {
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    incrby: vi.fn(async (key: string, n: number) => {
      const next = (Number.parseInt(store.get(key) ?? "0", 10) || 0) + n;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
}

describe("extract token budget (G3.19)", () => {
  it("disables when budget is 0", async () => {
    const redis = fakeRedis(new Map());
    await expect(checkExtractTokenBudget(redis as never, "repo", 0)).resolves.toEqual({
      ok: true,
      used: 0,
    });
  });

  it("blocks when used >= budget", async () => {
    const store = new Map<string, string>();
    const redis = fakeRedis(store);
    const key = extractTokenBudgetKey("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    store.set(key, "1000");
    await expect(
      checkExtractTokenBudget(redis as never, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", 1000),
    ).resolves.toEqual({ ok: false, used: 1000, budget: 1000 });
  });

  it("records tokens and sets TTL on first write", async () => {
    const store = new Map<string, string>();
    const redis = fakeRedis(store);
    const used = await recordExtractTokens(
      redis as never,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      42,
    );
    expect(used).toBe(42);
    expect(redis.expire).toHaveBeenCalled();
  });
});
