import { describe, expect, it } from "vitest";
import { upsertDecisionVectors } from "../src/store/decisions.js";

describe("decisions qdrant store", () => {
  it("refuses empty vectors", async () => {
    const client = {
      upsert: async () => ({}),
    } as never;

    await expect(
      upsertDecisionVectors(client, [{ id: "x", vector: [], payload: {} }]),
    ).rejects.toThrow(/empty vector/i);
  });
});
