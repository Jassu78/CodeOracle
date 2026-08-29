import {
  SearchCodebaseInputSchema,
  SearchCodebaseOutputSchema,
  type SearchCodebaseOutput,
} from "@codeoracle/contracts";

export type SearchCodebaseRunner = (input: {
  query: string;
  topK: number;
}) => Promise<SearchCodebaseOutput>;

export async function runSearchCodebaseTool(
  runner: SearchCodebaseRunner,
  rawArgs: unknown,
): Promise<SearchCodebaseOutput> {
  const input = SearchCodebaseInputSchema.parse(rawArgs ?? {});
  const output = await runner({
    query: input.query,
    topK: input.topK ?? 10,
  });
  return SearchCodebaseOutputSchema.parse(output);
}

export function formatSearchCodebaseText(output: SearchCodebaseOutput): string {
  if (output.results.length === 0) {
    return "No code chunks matched that query for the configured repo.";
  }

  return output.results
    .map((r, i) => {
      const symbol = r.symbolName ? ` (${r.symbolName})` : "";
      const preview = r.content.replace(/\s+/g, " ").trim().slice(0, 200);
      const ellipsis = r.content.replace(/\s+/g, " ").trim().length > 200 ? "…" : "";
      return [
        `${i + 1}. ${r.filePath}${symbol} (score=${r.score.toFixed(3)})`,
        preview + ellipsis,
      ].join("\n");
    })
    .join("\n\n");
}
