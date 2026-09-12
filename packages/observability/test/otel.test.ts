import { describe, expect, it } from "vitest";
import { withSpan, recordDurationMs } from "../src/trace.js";
import { initOtel } from "../src/otel.js";

describe("otel optional path", () => {
  it("withSpan returns fn result when SDK is not registered", async () => {
    const value = await withSpan("test.span", { k: "v" }, async () => 42);
    expect(value).toBe(42);
  });

  it("withSpan rethrows", async () => {
    await expect(
      withSpan("test.fail", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("recordDurationMs is a no-op without SDK", () => {
    expect(() => recordDurationMs("test.latency", 12, { tool: "x" })).not.toThrow();
  });

  it("initOtel no-op when disabled", async () => {
    const shutdown = await initOtel({
      env: {
        OTEL_ENABLED: false,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        OTEL_SERVICE_NAME: undefined,
      },
      defaultServiceName: "test",
    });
    await expect(shutdown()).resolves.toBeUndefined();
  });

  it("initOtel skips when enabled without endpoint", async () => {
    const shutdown = await initOtel({
      env: {
        OTEL_ENABLED: true,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        OTEL_SERVICE_NAME: undefined,
      },
      defaultServiceName: "test",
    });
    await expect(shutdown()).resolves.toBeUndefined();
  });
});
