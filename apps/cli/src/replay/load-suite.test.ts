import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadReplaySuite } from "./load-suite.js";

/** Monorepo root from `apps/cli/src/replay/`. */
const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const suitesDir = join(repoRoot, "test/replay/suites");

describe("loadReplaySuite", () => {
  it("accepts every committed suite under test/replay/suites", () => {
    const files = readdirSync(suitesDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const suite = loadReplaySuite(join(suitesDir, file));
      expect(suite.version).toBe(1);
      expect(suite.cases.length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid suite JSON shape", () => {
    expect(() => loadReplaySuite(join(suitesDir, "does-not-exist.json"))).toThrow(
      /Cannot read replay suite/,
    );
  });
});
