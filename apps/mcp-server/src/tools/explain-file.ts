import {
  ExplainFileInputSchema,
  ExplainFileOutputSchema,
  type ExplainFileOutput,
} from "@codeoracle/contracts";

export type ExplainFileRunner = (input: { path: string }) => Promise<ExplainFileOutput>;

export async function runExplainFileTool(
  runner: ExplainFileRunner,
  rawArgs: unknown,
): Promise<ExplainFileOutput> {
  const input = ExplainFileInputSchema.parse(rawArgs ?? {});
  const output = await runner({ path: input.path });
  return ExplainFileOutputSchema.parse(output);
}

export function formatExplainFileText(output: ExplainFileOutput): string {
  const chunks =
    output.chunkSummaries.length === 0
      ? "No indexed chunks for this path."
      : output.chunkSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const decisions =
    output.relatedDecisions.length === 0
      ? "No related decisions."
      : output.relatedDecisions
          .map((d, i) => {
            const status = d.superseded ? "superseded" : "active";
            return [
              `${i + 1}. ${d.topic} [${status}] (${d.decidedAt})`,
              d.summary,
              `Source: ${d.sourceUrl}`,
            ].join("\n");
          })
          .join("\n\n");

  return [`File: ${output.path}`, "", "Chunks:", chunks, "", "Related decisions:", decisions].join(
    "\n",
  );
}
