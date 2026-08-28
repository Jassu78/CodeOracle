/** Best-effort secret scrubber before text is sent to external LLM endpoints (FR-13 / spec §6.1.7). */

const PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github_pat", pattern: /ghp_[A-Za-z0-9]{20,}/g },
  { name: "github_oauth", pattern: /gho_[A-Za-z0-9]{20,}/g },
  { name: "openai_sk", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "pem_block", pattern: /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g },
  {
    name: "env_high_entropy",
    pattern: /^[A-Z0-9_]{3,}=(?:[^\s'"]{8,}|"[^"]{12,}"|'[^']{12,}')$/gm,
  },
];

export type RedactionHit = { name: string; count: number };

export function redactSecrets(text: string): { redacted: string; hits: RedactionHit[] } {
  let redacted = text;
  const hits: RedactionHit[] = [];

  for (const { name, pattern } of PATTERNS) {
    const matches = redacted.match(pattern);
    if (!matches?.length) continue;
    hits.push({ name, count: matches.length });
    redacted = redacted.replace(pattern, `[REDACTED:${name}]`);
  }

  return { redacted, hits };
}
