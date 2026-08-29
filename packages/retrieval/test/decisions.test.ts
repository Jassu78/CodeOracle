import { describe, expect, it } from "vitest";
import { decisionEmbedText, upsertDecisionVectors } from "../src/store/decisions.js";

describe("decisions qdrant store", () => {
  it("refuses empty vectors", async () => {
    const client = {
      upsert: async () => ({}),
    } as never;

    await expect(
      upsertDecisionVectors(client, [{ id: "x", vector: [], payload: {} }]),
    ).rejects.toThrow(/empty vector/i);
  });

  it("includes alternatives in embed text when present", () => {
    expect(decisionEmbedText("JWT", "Stateless auth.", ["sessions"])).toContain(
      "Alternatives considered: sessions",
    );
    expect(decisionEmbedText("JWT", "Stateless auth.")).not.toContain("Alternatives");
  });
});
