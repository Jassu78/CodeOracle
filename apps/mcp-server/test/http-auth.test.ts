import { describe, expect, it } from "vitest";
import { authorizeMcpBearerToken } from "../src/transport/http.js";

const REPO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REPO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("authorizeMcpBearerToken", () => {
  it("rejects unknown tokens", async () => {
    const r = await authorizeMcpBearerToken({
      token: "nope",
      repoId: REPO_A,
      apiToken: "admin",
      lookupRepoToken: async () => null,
    });
    expect(r).toEqual({ ok: false, status: 401, error: "invalid bearer token" });
  });

  it("accepts admin and dedicated MCP secrets", async () => {
    expect(
      await authorizeMcpBearerToken({
        token: "admin",
        repoId: REPO_A,
        apiToken: "admin",
        lookupRepoToken: async () => null,
      }),
    ).toEqual({ ok: true });
    expect(
      await authorizeMcpBearerToken({
        token: "mcp",
        repoId: REPO_A,
        mcpHttpBearerToken: "mcp",
        lookupRepoToken: async () => null,
      }),
    ).toEqual({ ok: true });
  });

  it("enforces per-repo scope (H6)", async () => {
    const lookup = async (raw: string) =>
      raw === "tok-a" ? { repoId: REPO_A } : raw === "tok-b" ? { repoId: REPO_B } : null;

    expect(
      await authorizeMcpBearerToken({
        token: "tok-a",
        repoId: REPO_A,
        lookupRepoToken: lookup,
      }),
    ).toEqual({ ok: true });

    expect(
      await authorizeMcpBearerToken({
        token: "tok-b",
        repoId: REPO_A,
        lookupRepoToken: lookup,
      }),
    ).toEqual({ ok: false, status: 403, error: "token not scoped to this repository" });
  });
});
