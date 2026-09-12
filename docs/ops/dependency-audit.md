# Dependency audit policy (E10)

**Goal:** catch high/critical production advisories in CI without papering over real risk.

## CI gate

| Command | When | Fail on |
|---------|------|---------|
| `pnpm audit:ci` → `pnpm audit --prod --audit-level=high` | Every PR (`ci.yml` job `dependency-audit`) | **high** and **critical** only |

Moderate / low findings are **visible** in local `pnpm audit --prod` but do not fail the gate. Prefer fixing them via Dependabot (already weekly) rather than ignoring.

## Allowlist (carefully)

If a high/critical advisory cannot be fixed immediately (no patch, or only via a breaking major):

1. Prefer `pnpm.overrides` / dependency bump that removes the vulnerable path.
2. Only if blocked: add the **CVE / GHSA id** under `pnpm.auditConfig.ignoreCves` in the **root** `package.json`, with an inline comment in `docs/ops/dependency-audit.md` stating:
   - advisory id + package
   - why production risk is accepted (or not reachable)
   - owner + review-by date
3. Never ignore an advisory “to make CI green” without that note.
4. Revisit allowlisted entries every Dependabot cycle; delete when fixed.

Empty allowlist is the default. Do **not** copy npm’s `--force` / blanket ignore.

Example shape (comments belong in this doc, not in `package.json`):

```json
{
  "pnpm": {
    "auditConfig": {
      "ignoreCves": ["CVE-YYYY-NNNNN"]
    }
  }
}
```

Document each ignored id in this file with package, rationale, owner, and review-by date.

## Related

- Dependabot: `.github/dependabot.yml` (weekly npm + Actions minors/patches)
- CodeQL: `.github/workflows/codeql.yml` (SAST on default branch + PRs)
- Local: `pnpm audit --prod` (all severities)
