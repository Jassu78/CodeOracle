import { describe, expect, it } from "vitest";
import { createFallbackPlugin } from "../src/plugins/fallback-plugin.js";

describe("fallback sliding-window plugin", () => {
  it("never drops content — chunks cover the full source with overlap", () => {
    const plugin = createFallbackPlugin("unknown(.rs)");
    const source = "x".repeat(5000);
    const chunks = plugin.chunk("file.rs", source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.byteStart).toBe(0);
    expect(chunks[chunks.length - 1]!.byteEnd).toBe(source.length);
    for (const c of chunks) {
      expect(c.symbolName).toBeNull();
    }
  });

  it("handles content smaller than one window", () => {
    const plugin = createFallbackPlugin("unknown(.rs)");
    const chunks = plugin.chunk("tiny.rs", "small file");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe("small file");
  });
});
