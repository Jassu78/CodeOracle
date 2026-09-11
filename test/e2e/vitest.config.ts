import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    // Integration tests share Qdrant + Redis/BullMQ against real infra.
    // Keep fileParallelism off to avoid job/queue races (E8 scoped clears no
    // longer wipe peer repos on hybrid, but concurrent full-index jobs still contend).
    fileParallelism: false,
  },
});
