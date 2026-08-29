import { describe, expect, it } from "vitest";
import { applyHybridCutoff, fuseRrf } from "../src/hybrid-rrf.js";

describe("fuseRrf", () => {
  it("scores dual-channel hits above single-channel", () => {
    const fused = fuseRrf([
      { channel: "dense", ids: ["a", "b", "c"] },
      { channel: "sparse", ids: ["a", "d"] },
    ]);
    expect(fused[0]?.id).toBe("a");
    expect(fused[0]?.channels).toEqual(["dense", "sparse"]);
    expect(fused.find((h) => h.id === "b")?.channels).toEqual(["dense"]);
  });

  it("includes ids from either channel", () => {
    const fused = fuseRrf([
      { channel: "dense", ids: ["only-dense"] },
      { channel: "sparse", ids: ["only-sparse"] },
    ]);
    expect(fused.map((h) => h.id).sort()).toEqual(["only-dense", "only-sparse"]);
  });
});

describe("applyHybridCutoff", () => {
  const hits = fuseRrf([
    { channel: "dense", ids: ["both", "dense-only", "dense-tail"] },
    { channel: "sparse", ids: ["both", "sparse-only"] },
  ]);

  it("keeps dual-channel hits when minChannels=2", () => {
    const cut = applyHybridCutoff(hits, { limit: 10, minChannels: 2, relativeFloor: 0 });
    expect(cut.every((h) => h.channels.length === 2)).toBe(true);
    expect(cut.map((h) => h.id)).toEqual(["both"]);
  });

  it("falls back to single-channel when dual-channel empties", () => {
    const sparseOnly = fuseRrf([
      { channel: "dense", ids: [] },
      { channel: "sparse", ids: ["s1", "s2"] },
    ]);
    const cut = applyHybridCutoff(sparseOnly, { limit: 10, minChannels: 2, relativeFloor: 0 });
    expect(cut.map((h) => h.id)).toEqual(["s1", "s2"]);
  });

  it("drops bottom ranks via relativeFloor", () => {
    // Craft scores: top high, tail low — relativeFloor 0.9 should drop weak ranks.
    const ranked = [
      { id: "top", score: 1.0, channels: ["dense", "sparse"] as const },
      { id: "mid", score: 0.95, channels: ["dense"] as const },
      { id: "tail", score: 0.2, channels: ["sparse"] as const },
    ];
    const cut = applyHybridCutoff(ranked, { limit: 10, minChannels: 1, relativeFloor: 0.5 });
    expect(cut.map((h) => h.id)).toEqual(["top", "mid"]);
  });

  it("respects limit after floor", () => {
    const cut = applyHybridCutoff(hits, { limit: 1, minChannels: 1, relativeFloor: 0 });
    expect(cut).toHaveLength(1);
    expect(cut[0]?.id).toBe("both");
  });
});
