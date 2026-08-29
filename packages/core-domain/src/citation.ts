/**
 * Domain rule: "no citation = bug" (PRD §5 principle 2 / production-spec
 * §"no citation = bug"). A Decision or code-chunk result is only safe to
 * hand back to an agent if it carries a real, dereferenceable URL — this is
 * the single predicate every MCP tool boundary (`find_decision`,
 * `search_codebase`, `explain_file`) uses to decide whether a row is
 * citation-worthy. Framework-free by design so it can be unit-tested and
 * reused without importing Postgres/Qdrant/HTTP.
 */
export function isCitationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
