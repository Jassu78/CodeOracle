import { describe, expect, it } from "vitest";
import {
  applyHybridCutoff,
  dualChannelPrimaryCap,
  fuseRrf,
} from "../src/hybrid-rrf.js";

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

describe("dualChannelPrimaryCap", () => {
  it("leaves half the limit for backfill", () => {
    expect(dualChannelPrimaryCap(5)).toBe(2);
    expect(dualChannelPrimaryCap(3)).toBe(1);
    expect(dualChannelPrimaryCap(10)).toBe(5);
    expect(dualChannelPrimaryCap(1)).toBe(1);
  });
});

describe("applyHybridCutoff", () => {
  const hits = fuseRrf([
    { channel: "dense", ids: ["both", "dense-only", "dense-tail"] },
    { channel: "sparse", ids: ["both", "sparse-only"] },
  ]);

  it("keeps dual-channel hits when minChannels=2", () => {
    const cut = applyHybridCutoff(hits, { limit: 10, minChannels: 2, relativeFloor: 0 });
    expect(cut.some((h) => h.id === "both")).toBe(true);
  });

  it("backfills dense-only when dual-channel leaves slots (Q1)", () => {
    // Docs win both channels; code is dense-only — must not disappear when dual is non-empty.
    const fused = fuseRrf([
      { channel: "dense", ids: ["readme-a", "readme-b", "github-signature"] },
      { channel: "sparse", ids: ["readme-a", "readme-b"] },
    ]);
    const cut = applyHybridCutoff(fused, {
      limit: 3,
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });
    expect(cut.map((h) => h.id)).toContain("github-signature");
    expect(cut.some((h) => h.id.startsWith("readme"))).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(3);
  });

  it("caps dual share so code can appear in hit@3 (Q1 live HMAC shape)", () => {
    // Three strong dual doc chunks + mid dual code (failed dual floor) — mirrors
    // live R1 where github-signature is dual but below dualFloor.
    const fused = [
      { id: "readme-a", score: 0.583, channels: ["dense", "sparse"] as const },
      { id: "readme-b", score: 0.476, channels: ["dense", "sparse"] as const },
      { id: "readme-c", score: 0.375, channels: ["dense", "sparse"] as const },
      { id: "github-signature", score: 0.237, channels: ["dense", "sparse"] as const },
      { id: "sparse-noise", score: 0.2, channels: ["sparse"] as const },
    ];
    const cut = applyHybridCutoff(fused, {
      limit: 5,
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });
    const top3 = cut.slice(0, 3).map((h) => h.id);
    expect(top3).toContain("github-signature");
    expect(top3.filter((id) => id.startsWith("readme")).length).toBeLessThanOrEqual(2);
  });

  it("prefers weak dual backfill before sparse-only", () => {
    const fused = [
      { id: "both", score: 0.6, channels: ["dense", "sparse"] as const },
      { id: "weak-dual", score: 0.22, channels: ["dense", "sparse"] as const },
      { id: "sparse-noise", score: 0.2, channels: ["sparse"] as const },
    ];
    const cut = applyHybridCutoff(fused, {
      limit: 2,
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });
    expect(cut.map((h) => h.id)).toEqual(["both", "weak-dual"]);
  });

  it("prefers dense-only backfill before weak dual (Q1 R1 class)", () => {
    // Strong dual docs fill primary; weak dual prose + dense-only impl compete for
    // backfill — impl must win (general: dense-strong/sparse-miss code).
    const fused = [
      { id: "doc-strong-a", score: 0.583, channels: ["dense", "sparse"] as const },
      { id: "doc-strong-b", score: 0.343, channels: ["dense", "sparse"] as const },
      { id: "src-related-dual", score: 0.292, channels: ["dense", "sparse"] as const },
      { id: "impl-dense-only", score: 0.25, channels: ["dense"] as const },
      { id: "doc-weak-dual", score: 0.15, channels: ["dense", "sparse"] as const },
      { id: "sparse-noise", score: 0.333, channels: ["sparse"] as const },
    ];
    const cut = applyHybridCutoff(fused, {
      limit: 5,
      minChannels: 2,
      relativeFloor: 0.5,
      backfillSingleChannel: true,
    });
    expect(cut.map((h) => h.id)).toContain("impl-dense-only");
    const implIdx = cut.findIndex((h) => h.id === "impl-dense-only");
    const weakDocIdx = cut.findIndex((h) => h.id === "doc-weak-dual");
    expect(implIdx).toBeGreaterThanOrEqual(0);
    if (weakDocIdx >= 0) {
      expect(implIdx).toBeLessThan(weakDocIdx);
    }
    // hit@3 after path diversity still needs impl early among unique intents
    expect(cut.slice(0, 4).map((h) => h.id)).toContain("impl-dense-only");
  });

  it("prefers dense-only backfill before sparse-only", () => {
    const fused = fuseRrf([
      { channel: "dense", ids: ["both", "dense-code"] },
      { channel: "sparse", ids: ["both", "sparse-noise"] },
    ]);
    const cut = applyHybridCutoff(fused, {
      limit: 2,
      minChannels: 2,
      relativeFloor: 0,
      backfillSingleChannel: true,
    });
    expect(cut.map((h) => h.id)).toEqual(["both", "dense-code"]);
  });

  it("can disable backfill to restore dual-only-when-non-empty", () => {
    const fused = fuseRrf([
      { channel: "dense", ids: ["readme", "code"] },
      { channel: "sparse", ids: ["readme"] },
    ]);
    const cut = applyHybridCutoff(fused, {
      limit: 5,
      minChannels: 2,
      relativeFloor: 0,
      backfillSingleChannel: false,
    });
    expect(cut.map((h) => h.id)).toEqual(["readme"]);
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
    const ranked = [
      { id: "top", score: 1.0, channels: ["dense", "sparse"] as const },
      { id: "mid", score: 0.95, channels: ["dense"] as const },
      { id: "tail", score: 0.2, channels: ["sparse"] as const },
    ];
    const cut = applyHybridCutoff(ranked, {
      limit: 10,
      minChannels: 1,
      relativeFloor: 0.5,
    });
    expect(cut.map((h) => h.id)).toEqual(["top", "mid"]);
  });

  it("respects limit after floor", () => {
    const cut = applyHybridCutoff(hits, { limit: 1, minChannels: 1, relativeFloor: 0 });
    expect(cut).toHaveLength(1);
    expect(cut[0]?.id).toBe("both");
  });
});
