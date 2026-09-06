import { describe, expect, it } from "vitest";
import { scoreReplayFind, scoreReplaySearch } from "./score.js";

describe("scoreReplaySearch", () => {
  it("passes when a path substring appears within hitAt", () => {
    const r = scoreReplaySearch(
      [
        { filePath: "apps/api/README.md" },
        { filePath: "apps/api/src/webhooks/handle-github-push.ts" },
        { filePath: "apps/api/src/webhooks/github-signature.ts" },
      ],
      { anyOfPathIncludes: ["github-signature.ts"], hitAt: 3 },
    );
    expect(r.passed).toBe(true);
  });

  it("fails when match is outside hitAt", () => {
    const r = scoreReplaySearch(
      [
        { filePath: "README.md" },
        { filePath: "CONTRIBUTING.md" },
        { filePath: "other.ts" },
        { filePath: "github-signature.ts" },
      ],
      { anyOfPathIncludes: ["github-signature.ts"], hitAt: 3 },
    );
    expect(r.passed).toBe(false);
  });

  it("matches symbolName when path lacks the needle (R4 authorize class)", () => {
    const r = scoreReplaySearch(
      [
        { filePath: "README.md" },
        {
          filePath: "apps/mcp-server/src/transport/http.ts",
          symbolName: "authorizeMcpBearerToken",
        },
      ],
      { anyOfPathIncludes: ["auth.ts", "authorize"], hitAt: 3 },
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/authorize/);
  });
});

describe("scoreReplayFind", () => {
  it("enforces maxCount and content needles", () => {
    const ok = scoreReplayFind(
      [
        {
          topic: "GitHub HMAC webhooks",
          summary: "Verify signatures",
          sourceUrl: "https://github.com/org/repo/pull/1",
        },
      ],
      {
        maxCount: 3,
        topicOrSummaryIncludesAny: ["hmac"],
        requireCitationHttp: true,
      },
    );
    expect(ok.passed).toBe(true);

    const bleed = scoreReplayFind(
      [
        {
          topic: "HMAC",
          summary: "a",
          sourceUrl: "https://github.com/org/repo/pull/1",
        },
        {
          topic: "noise",
          summary: "b",
          sourceUrl: "https://github.com/org/repo/pull/2",
        },
      ],
      {
        maxCount: 1,
        topicOrSummaryIncludesAny: ["hmac"],
        requireCitationHttp: true,
      },
    );
    expect(bleed.passed).toBe(false);
    expect(bleed.detail).toMatch(/maxCount/);
  });

  it("rejects non-http citations when required", () => {
    const r = scoreReplayFind(
      [{ topic: "HMAC", summary: "x", sourceUrl: "not-a-url" }],
      {
        topicOrSummaryIncludesAny: ["hmac"],
        requireCitationHttp: true,
      },
    );
    expect(r.passed).toBe(false);
  });
});
