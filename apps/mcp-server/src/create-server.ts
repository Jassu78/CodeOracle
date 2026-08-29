import {
  ExplainFileOutputSchema,
  FindDecisionOutputSchema,
  SearchCodebaseOutputSchema,
} from "@codeoracle/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatExplainFileText,
  runExplainFileTool,
  type ExplainFileRunner,
} from "./tools/explain-file.js";
import {
  formatFindDecisionText,
  runFindDecisionTool,
  type FindDecisionRunner,
} from "./tools/find-decision.js";
import {
  formatSearchCodebaseText,
  runSearchCodebaseTool,
  type SearchCodebaseRunner,
} from "./tools/search-codebase.js";

export type CreateCodeOracleMcpServerOpts = {
  findDecision: FindDecisionRunner;
  searchCodebase: SearchCodebaseRunner;
  explainFile: ExplainFileRunner;
};

/**
 * Builds an MCP server with Stage 4 tools. Transport (stdio/HTTP) is attached by main.
 */
export function createCodeOracleMcpServer(opts: CreateCodeOracleMcpServerOpts): McpServer {
  const server = new McpServer({
    name: "codeoracle",
    version: "0.0.0",
  });

  server.registerTool(
    "find_decision",
    {
      description:
        "Find architectural decisions (WHY) for a topic. Returns summaries, alternatives, confidence, and a mandatory source URL (PR or commit).",
      inputSchema: {
        topic: z.string().min(1).describe("Topic or question, e.g. 'session store' or 'why Postgres'"),
        includeHistory: z
          .boolean()
          .optional()
          .describe("When true, include superseded decisions. Default false (active tip only)."),
      },
      outputSchema: FindDecisionOutputSchema,
    },
    async (args) => {
      try {
        const output = await runFindDecisionTool(opts.findDecision, args);
        return {
          content: [{ type: "text" as const, text: formatFindDecisionText(output) }],
          structuredContent: output,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `find_decision failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "search_codebase",
    {
      description:
        "Semantic search over indexed code chunks. Every hit includes a file path citation.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language or keyword query"),
        topK: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Max results (default 10, max 50)"),
      },
      outputSchema: SearchCodebaseOutputSchema,
    },
    async (args) => {
      try {
        const output = await runSearchCodebaseTool(opts.searchCodebase, args);
        return {
          content: [{ type: "text" as const, text: formatSearchCodebaseText(output) }],
          structuredContent: output,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `search_codebase failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "explain_file",
    {
      description:
        "Explain an indexed file from stored chunks plus related Decisions that touched its path. Deterministic — no LLM rewrite.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Repo-relative file path, e.g. apps/api/src/main.ts"),
      },
      outputSchema: ExplainFileOutputSchema,
    },
    async (args) => {
      try {
        const output = await runExplainFileTool(opts.explainFile, args);
        return {
          content: [{ type: "text" as const, text: formatExplainFileText(output) }],
          structuredContent: output,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `explain_file failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
