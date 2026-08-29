import { describe, expect, it, vi } from "vitest";
import { explainFile } from "../src/explain-file.js";
import type { ChunkRow, DecisionRow } from "@codeoracle/db";

const repoId = "9462ddb7-6064-4620-87c7-584566f643af";

function chunk(partial: Partial<ChunkRow> & Pick<ChunkRow, "id" | "byteStart" | "content">): ChunkRow {
  return {
    repoId,
    filePath: "apps/api/src/main.ts",
    symbolName: null,
    parentSymbol: null,
    language: "ts",
    byteEnd: partial.byteStart + 20,
    contentHash: "h",
    embeddingModelId: "ollama:nomic",
    embeddingStatus: "embedded",
    qdrantPointId: partial.id,
    lastIndexedSha: "abc",
    createdAt: new Date(),
    ...partial,
  };
}

function decision(
  partial: Partial<DecisionRow> & Pick<DecisionRow, "id" | "topic" | "summary" | "sourceUrl">,
): DecisionRow {
  return {
    repoId,
    alternativesConsidered: [],
    decidedAt: new Date("2026-01-15T12:00:00.000Z"),
    sourceType: "pr",
    sourceSha: "abc",
    touchedPaths: ["apps/api"],
    confidence: 0.9,
    supersededBy: null,
    embeddingModelId: "ollama:nomic",
    extractionModelId: "ollama:gpt",
    createdAt: new Date(),
    ...partial,
  };
}

const stubDb = {} as never;

describe("explainFile", () => {
  it("rejects empty path / repoId", async () => {
    await expect(
      explainFile({ db: stubDb, repoId, path: "  " }),
    ).rejects.toThrow(/path/);
    await expect(
      explainFile({ db: stubDb, repoId: "", path: "a.ts" }),
    ).rejects.toThrow(/repoId/);
  });

  it("returns chunk summaries and cited decisions only", async () => {
    const listChunks = vi.fn(async () => [
      chunk({
        id: "11111111-1111-4111-8111-111111111111",
        byteStart: 0,
        content: "import express from 'express'",
        symbolName: null,
      }),
      chunk({
        id: "22222222-2222-4222-8222-222222222222",
        byteStart: 40,
        content: "export function boot() { return true }",
        symbolName: "boot",
      }),
    ]);
    const listDecisions = vi.fn(async () => [
      decision({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        topic: "API framework",
        summary: "Chose Express for middleware ecosystem.",
        sourceUrl: "https://github.com/org/repo/pull/3",
      }),
      decision({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        topic: "Broken",
        summary: "No citation",
        sourceUrl: "not-a-url",
      }),
    ]);

    const out = await explainFile({
      db: stubDb,
      repoId,
      path: "apps/api/src/main.ts",
      deps: { listChunks, listDecisions },
    });

    expect(out.path).toBe("apps/api/src/main.ts");
    expect(out.chunkSummaries).toHaveLength(2);
    expect(out.chunkSummaries[1]).toContain("boot");
    expect(out.relatedDecisions).toHaveLength(1);
    expect(out.relatedDecisions[0]).toMatchObject({
      topic: "API framework",
      sourceUrl: "https://github.com/org/repo/pull/3",
      superseded: false,
      decidedAt: "2026-01-15T12:00:00.000Z",
    });
  });

  it("returns empty arrays when file unknown", async () => {
    const out = await explainFile({
      db: stubDb,
      repoId,
      path: "missing.ts",
      deps: {
        listChunks: async () => [],
        listDecisions: async () => [],
      },
    });
    expect(out.chunkSummaries).toEqual([]);
    expect(out.relatedDecisions).toEqual([]);
  });
});
