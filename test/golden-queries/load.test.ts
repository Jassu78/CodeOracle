import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GoldenQuerySetSchema } from "@codeoracle/contracts";
import { SAMPLE_REPO_FINAL_PATHS } from "../fixtures/sample-repo/build.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("golden-queries (D5.1)", () => {
  it("loads queries.json and satisfies the contract (10–15 queries)", async () => {
    const raw = JSON.parse(await readFile(join(here, "queries.json"), "utf8"));
    const set = GoldenQuerySetSchema.parse(raw);

    expect(set.version).toBe(1);
    expect(set.fixture).toBe("test/fixtures/sample-repo");
    expect(set.queries.length).toBeGreaterThanOrEqual(10);
    expect(set.queries.length).toBeLessThanOrEqual(15);

    const byTool = {
      search_codebase: 0,
      find_decision: 0,
      explain_file: 0,
    };
    for (const q of set.queries) {
      byTool[q.tool] += 1;
    }
    expect(byTool.search_codebase).toBeGreaterThanOrEqual(5);
    expect(byTool.find_decision).toBeGreaterThanOrEqual(3);
    expect(byTool.explain_file).toBeGreaterThanOrEqual(2);

    const ids = new Set(set.queries.map((q) => q.id));
    expect(ids.size).toBe(set.queries.length);

    for (const q of set.queries) {
      if (q.tool === "search_codebase") {
        for (const p of q.expect.anyOfFilePaths) {
          expect(SAMPLE_REPO_FINAL_PATHS).toContain(p);
        }
      }
      if (q.tool === "explain_file") {
        expect(SAMPLE_REPO_FINAL_PATHS).toContain(q.expect.path);
      }
    }
  });
});
