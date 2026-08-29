/**
 * Cheap pre-LLM filter — skip sources that almost never encode architectural WHY.
 * Deterministic; keep conservative to avoid dropping real decisions.
 * Domain rule (extraction adapter calls this before spending provider quota).
 */
const TRIVIAL_SUBJECT =
  /^(chore|ci|build|docs?|style|test|tests|refactor\(fmt\)|fmt)(\(.+\))?:\s/i;

const TRIVIAL_PATTERNS: RegExp[] = [
  /^(bump|update|upgrade)\s+[\w@/.-]+\s*(from\s|to\s+v?\d|\(|$)/i,
  /^bump\s+.+\s+from\s+\S+\s+to\s+/i,
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
  // Dependabot / Renovate / version-only releases.
  /^chore\(deps\):\s/i,
  /^(deps?|dependencies):\s*(bump|update|upgrade)\b/i,
  /\b(dependabot|renovate)\b/i,
  /^release:\s*v?\d+\.\d+/i,
  /^v?\d+\.\d+\.\d+(\s|$)/i,
  /^(npm|pnpm|yarn)\s+(audit\s+fix|lockfile)\b/i,
  /^apply\s+(prettier|eslint|black|rustfmt)\b/i,
  /^(auto[- ]?)?(format|lint)(\s+fix)?$/i,
];

const RATIONALE_ESCAPE =
  /\b(because|instead of|rather than|trade-?off|migrat|replac|switch(ed|ing)? to|so that|in order to)\b/i;

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
