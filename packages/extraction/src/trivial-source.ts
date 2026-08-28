/**
 * Cheap pre-LLM filter — skip sources that almost never encode architectural WHY.
 * Deterministic; keep conservative to avoid dropping real decisions.
 */
const TRIVIAL_SUBJECT =
  /^(chore|ci|build|docs?|style|test|tests|refactor\(fmt\)|fmt)(\(.+\))?:\s/i;

const TRIVIAL_PATTERNS: RegExp[] = [
  /^(bump|update|upgrade)\s+[\w@/.-]+\s*(to\s+v?\d|\(|$)/i,
  /^bump\s+(version|deps?|dependencies)\b/i,
  /^(fix|chore):\s*(typo|spelling|whitespace|formatting|lint)\b/i,
  /^(style|format|fmt):\s/i,
  /^merge\s+(branch|pull request|remote-tracking)\b/i,
  /^revert\s+"[^"]+"$/,
  /^wip\b/i,
  /^tmp\b/i,
  // Lockfile / package-lock only bumps (no rationale).
  /^(chore|build|deps?)(\(.+\))?:\s.*(package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|poetry\.lock)/i,
  /^update\s+(package-lock|pnpm-lock|yarn\.lock)\b/i,
];

const RATIONALE_ESCAPE =
  /\b(because|instead of|rather than|trade-?off|migrat|replac|switch(ed|ing)? to)\b/i;

export function isTrivialSourceMessage(title: string, body = ""): boolean {
  const subject = title.trim().split("\n")[0] ?? "";
  if (!subject) return true;

  const blob = `${subject}\n${body}`;
  const hasRationale = RATIONALE_ESCAPE.test(blob);

  // Empty-body merge commits are almost never architectural decisions.
  if (/^merge\b/i.test(subject) && !body.trim() && !hasRationale) {
    return true;
  }

  if (TRIVIAL_SUBJECT.test(subject)) {
    if (hasRationale) return false;
    return true;
  }

  if (TRIVIAL_PATTERNS.some((re) => re.test(subject))) {
    if (hasRationale) return false;
    return true;
  }

  return false;
}
