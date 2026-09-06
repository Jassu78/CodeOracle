/**
 * Text fed to dense embed + sparse encoder for a code chunk.
 *
 * Path (full + basename) and symbol are prepended so hybrid channels can bind
 * NL/lexical queries to filenames and identifiers — not only body tokens.
 * Structured fields remain in Qdrant payload separately.
 *
 * Failure class (Q1 R4): body-only indexing leaves `authorizeForRepo` sparse-miss
 * / mid-dense while docs and near-miss neighbors win both channels.
 */
export function chunkIndexText(opts: {
  filePath: string;
  symbolName?: string | null;
  content: string;
}): string {
  const path = opts.filePath.trim().replace(/\\/g, "/");
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const symbol = opts.symbolName?.trim() ?? "";

  const headerLines: string[] = [];
  if (path) headerLines.push(path);
  if (base && base !== path) headerLines.push(base);
  if (symbol) headerLines.push(symbol);

  const body = opts.content.trim();
  if (headerLines.length === 0) return body;
  if (!body) return headerLines.join("\n");
  return `${headerLines.join("\n")}\n\n${body}`;
}
