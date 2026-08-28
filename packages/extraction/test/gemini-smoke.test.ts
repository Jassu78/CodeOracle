/**
 * Live Gemini extraction smoke — requires GEMINI_API_KEY + enabled gemini-free in providers.yaml.
 * Run: LIVE_GATEWAY_TEST=1 pnpm --filter @codeoracle/extraction exec vitest run test/gemini-smoke.test.ts
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractDecisionsFromSource } from "../src/extract-from-source.js";

const projectRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const live = process.env.LIVE_GATEWAY_TEST === "1" && Boolean(process.env.GEMINI_API_KEY);

describe.skipIf(!live)("gemini live extraction smoke", () => {
  it(
    "returns valid DecisionExtractionBatch from Gemini",
    async () => {
      const { loadEnv, loadProjectEnv, loadProvidersConfig } = await import("@codeoracle/config");
      const { ProviderRegistry } = await import("@codeoracle/gateway");
      const { logProviderUsage } = await import("@codeoracle/observability");

      loadProjectEnv(projectRoot);
      const env = loadEnv();
      const providers = loadProvidersConfig(resolve(projectRoot, env.PROVIDERS_CONFIG_PATH));
      const gateway = new ProviderRegistry({
        config: providers,
        env: process.env,
        onUsage: logProviderUsage,
      });

      const result = await extractDecisionsFromSource({
        gateway,
        source: {
          sourceType: "pr",
          title: "Switch from SQLite to Postgres for concurrent workers",
          body: [
            "BullMQ workers write concurrently; SQLite lock contention caused job failures under load.",
            "Postgres gives us proper connection pooling and is already in our compose stack.",
            "Alternatives considered: stay on SQLite (rejected), MongoDB (rejected — relational job history).",
          ].join("\n"),
          sourceUrl: "https://github.com/example/repo/pull/42",
          sourceSha: "deadbeef",
          decidedAtIso: "2026-08-01T12:00:00.000Z",
        },
      });

      expect(result.providerId).toMatch(/gemini/i);
      expect(Array.isArray(result.batch.decisions)).toBe(true);
      if (result.batch.decisions.length > 0) {
        expect(result.batch.decisions[0]!.summary.length).toBeGreaterThan(10);
        expect(result.batch.decisions[0]!.confidence).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});
