import {
  FindDecisionInputSchema,
  FindDecisionOutputSchema,
  type FindDecisionOutput,
} from "@codeoracle/contracts";

export type FindDecisionRunner = (input: {
  topic: string;
  includeHistory: boolean;
}) => Promise<FindDecisionOutput>;

/**
 * Pure tool handler — validates I/O contracts, no MCP SDK dependency.
 * Transport adapters call this and map the result to protocol content.
 */
export async function runFindDecisionTool(
  runner: FindDecisionRunner,
  rawArgs: unknown,
): Promise<FindDecisionOutput> {
  const input = FindDecisionInputSchema.parse(rawArgs ?? {});
  const output = await runner({
    topic: input.topic,
    includeHistory: input.includeHistory ?? false,
  });
  return FindDecisionOutputSchema.parse(output);
}

export function formatFindDecisionText(output: FindDecisionOutput): string {
  if (output.results.length === 0) {
    return "No decisions matched that topic for the configured repo.";
  }

  return output.results
    .map((r, i) => {
      const alts =
        r.alternativesConsidered.length > 0
          ? `Alternatives: ${r.alternativesConsidered.join("; ")}`
          : "Alternatives: (none recorded)";
      const status = r.superseded ? "superseded" : "active";
      return [
        `${i + 1}. ${r.topic} [${status}] (confidence=${r.confidence.toFixed(2)})`,
        r.summary,
        alts,
        `Source: ${r.sourceUrl}`,
      ].join("\n");
    })
    .join("\n\n");
}
