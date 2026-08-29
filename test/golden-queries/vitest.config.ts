import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "test/golden-queries/**/*.test.ts",
      "test/fixtures/sample-repo/**/*.test.ts",
    ],
    exclude: ["test/golden-queries/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
