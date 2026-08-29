import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/golden-queries/eval.integration.test.ts"],
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
