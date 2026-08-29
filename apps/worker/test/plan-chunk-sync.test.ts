import { describe, expect, it } from "vitest";
import { planChunkSync } from "../src/lib/plan-chunk-sync.js";

describe("planChunkSync", () => {
  it("keeps matching hashes and embeds only new ones", () => {
    const plan = planChunkSync(
      [
        { id: "1", contentHash: "aaa", qdrantPointId: "1" },
        { id: "2", contentHash: "bbb", qdrantPointId: "2" },
      ],
      [
        { contentHash: "aaa", filePath: "a.ts" },
        { contentHash: "ccc", filePath: "a.ts" },
      ],
    );

    expect(plan.deleteIds).toEqual(["2"]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0]?.contentHash).toBe("ccc");
    expect(plan.unchanged).toBe(false);
  });

  it("reports unchanged when hashes match exactly", () => {
    const plan = planChunkSync(
      [{ id: "1", contentHash: "aaa", qdrantPointId: "1" }],
      [{ contentHash: "aaa", filePath: "a.ts" }],
    );
    expect(plan.unchanged).toBe(true);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });
});
