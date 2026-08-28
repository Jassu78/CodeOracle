import { describe, expect, it } from "vitest";
import { upsertChunkVectors } from "../src/store/qdrant.js";

describe("qdrant store", () => {
  it("refuses empty vectors", async () => {
    const client = {
      upsert: async () => ({}),
    } as never;

    await expect(
      upsertChunkVectors(client, [{ id: "x", vector: [], payload: {} }]),
    ).rejects.toThrow(/empty vector/i);
  });
});
