import { describe, expect, it } from "vitest";
import { formatCursorMcpConfig } from "./mcp-config.js";

describe("formatCursorMcpConfig", () => {
  it("produces a paste-ready mcpServers config with the repo id and project path", () => {
    const json = formatCursorMcpConfig({
      projectRoot: "/Users/you/AlinGod/CodeOracle",
      repoId: "9462ddb7-6064-4620-87c7-584566f643af",
    });
    const parsed = JSON.parse(json);

    expect(parsed.mcpServers.codeoracle.command).toBe("pnpm");
    expect(parsed.mcpServers.codeoracle.args).toEqual([
      "--dir",
      "/Users/you/AlinGod/CodeOracle",
      "mcp",
    ]);
    expect(parsed.mcpServers.codeoracle.env.CODEORACLE_REPO_ID).toBe(
      "9462ddb7-6064-4620-87c7-584566f643af",
    );
  });
});
