import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    // Integration tests share one global Qdrant `code_chunks` collection and
    // one Redis-backed BullMQ queue against real infra — running test files
    // concurrently races destructive full-index calls (recreateHybrid...)
    // against each other. Force sequential execution rather than papering
    // over a real shared-resource constraint.
    fileParallelism: false,
  },
});
