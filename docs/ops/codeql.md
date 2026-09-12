# CodeQL (E10)

Workflow: `.github/workflows/codeql.yml` — runs on `main` PRs/pushes + weekly.

## Behavior

- Analyzes JavaScript/TypeScript (`build-mode: none`).
- **Upload to GitHub Code Scanning** is `never` until code scanning is enabled on this private repository (Settings → Code security and analysis → Code scanning). Without that, SARIF upload fails the job even when analysis succeeds.
- SARIF is retained as a workflow artifact (`codeql-javascript-typescript`) for 14 days.

## Enabling Security-tab upload

1. Repo **Settings → Code security** → enable **Code scanning**.
2. Change `upload: never` → `upload: always` (or remove the `upload` key) in `.github/workflows/codeql.yml`.
3. Keep `permissions.security-events: write`.

## Related

- Dependency audit gate: [`dependency-audit.md`](./dependency-audit.md)
- Dependabot: `.github/dependabot.yml`
