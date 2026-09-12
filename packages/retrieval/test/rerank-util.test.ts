import { describe, expect, it } from "vitest";
import { applyRerankOrder, withTimeout } from "../src/util.js";

describe("applyRerankOrder", () => {
  const items = [
    { chunkId: "a", score: 0.9 },
    { chunkId: "b", score: 0.8 },
    { chunkId: "c", score: 0.7 },
  ];

  it("reorders by ranked ids and appends missing in original order", () => {
    expect(applyRerankOrder(items, [{ id: "c", score: 1 }, { id: "a", score: 0.5 }]).map((x) => x.chunkId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("ignores unknown and duplicate ids", () => {
    expect(
      applyRerankOrder(items, [
        { id: "b", score: 1 },
        { id: "ghost", score: 9 },
        { id: "b", score: 0 },
      ]).map((x) => x.chunkId),
    ).toEqual(["b", "a", "c"]);
  });

  it("skips nullish ranked entries without throwing", () => {
    expect(
      applyRerankOrder(items, [
        null as unknown as { id: string; score: number },
        { id: "c", score: 1 },
      ]).map((x) => x.chunkId),
    ).toEqual(["c", "a", "b"]);
  });

  it("returns original order when ranked is empty", () => {
    expect(applyRerankOrder(items, []).map((x) => x.chunkId)).toEqual(["a", "b", "c"]);
  });
});

describe("withTimeout", () => {
  it("rejects after timeout", async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 20, "rerank"),
    ).rejects.toThrow(/timed out/);
  });
});
