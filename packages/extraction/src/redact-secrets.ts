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

/**
 * Generic catch-all for secrets pasted inline in prose (e.g. "the key was
 * <token>") that don't match a known vendor prefix and aren't in KEY=VALUE
 * shape — the gap the specific patterns above can't cover by design.
 *
 * Candidate tokens: contiguous non-whitespace runs of 20+ alnum/`+/_.=-`
 * chars (base64/key-shaped). To keep false positives low on legitimate
 * product content (this codebase's whole point is citing git SHAs and
 * commit hashes verbatim), a candidate is only redacted if it BOTH:
 *   1. Mixes uppercase + lowercase + digit — real key formats (base64,
 *      vendor tokens) almost always do; a lowercase-only git SHA/hex hash
 *      never does, so this alone excludes the single biggest legitimate
 *      false-positive class for this product.
 *   2. Has Shannon entropy ≥ 3.0 bits/char — filters out low-entropy
 *      mixed-case identifiers (e.g. camelCase function names) that happen
 *      to contain a digit.
 * Still best-effort, not a guarantee — see NFR-9.
 */
const GENERIC_TOKEN_RE = /[A-Za-z0-9+/_.=-]{20,}/g;
const MIN_GENERIC_ENTROPY_BITS = 3.0;

function shannonEntropyBitsPerChar(token: string): number {
  const counts = new Map<string, number>();
  for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikeSecretToken(token: string): boolean {
  const hasUpper = /[A-Z]/.test(token);
  const hasLower = /[a-z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  if (!(hasUpper && hasLower && hasDigit)) return false;
  return shannonEntropyBitsPerChar(token) >= MIN_GENERIC_ENTROPY_BITS;
}

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

  let genericCount = 0;
  redacted = redacted.replace(GENERIC_TOKEN_RE, (token) => {
    if (!looksLikeSecretToken(token)) return token;
    genericCount += 1;
    return "[REDACTED:generic_high_entropy_token]";
  });
  if (genericCount > 0) {
    hits.push({ name: "generic_high_entropy_token", count: genericCount });
  }

  return { redacted, hits };
}
