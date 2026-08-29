/**
 * Deterministic sample-repo materializer (PRD D5.1).
 *
 * Nested `.git` is never committed into CodeOracle — this builder creates a
 * temp (or caller-supplied) git checkout with fixed author/committer dates so
 * SHAs stay stable across machines. Citations resolve via a fake GitHub
 * `origin` remote (no network).
 *
 * Final working tree mirrors `tree/` for humans browsing the fixture.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SAMPLE_REPO_FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_REPO_ORIGIN = "https://github.com/codeoracle-test/sample-repo.git";

/** Fixed timeline — do not change without regenerating golden SHA expectations. */
const COMMIT_ENV_BASE = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "CodeOracle Fixture",
  GIT_AUTHOR_EMAIL: "fixture@codeoracle.test",
  GIT_COMMITTER_NAME: "CodeOracle Fixture",
  GIT_COMMITTER_EMAIL: "fixture@codeoracle.test",
};

export type SampleRepoBuild = {
  root: string;
  /** Newest → oldest commit SHAs on main. */
  commitShas: string[];
  cleanup: () => Promise<void>;
};

type CommitStep = {
  /** ISO date used for both author and committer. */
  date: string;
  message: string;
  files: Record<string, string>;
};

/**
 * Scripted history: each step encodes a clear architectural WHY where it matters.
 * Trivial chore-only commits are avoided so extract + find_decision goldens have signal.
 */
export const SAMPLE_REPO_HISTORY: CommitStep[] = [
  {
    date: "2024-01-10T12:00:00Z",
    message: "chore: scaffold sample-repo fixture",
    files: {
      "README.md":
        "# sample-repo\n\nPurpose-built fixture for CodeOracle golden-query eval (D5.1).\n" +
        "Not a real product — deliberate auth/cache/db layout with scripted WHY commits.\n",
    },
  },
  {
    date: "2024-01-11T12:00:00Z",
    message:
      "feat: add signed-cookie session store\n\n" +
      "Use signed cookies for session state instead of an in-memory server Map " +
      "so sessions survive process restarts without introducing Redis yet.",
    files: {
      "auth/session.ts": `export type Session = { userId: string; issuedAt: number };

const COOKIE_NAME = "co_session";

/** Sign + set session cookie — HMAC in production; fixture uses opaque token. */
export function writeSessionCookie(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return \`\${COOKIE_NAME}=\${payload}; Path=/; HttpOnly; SameSite=Lax\`;
}

export function readSessionCookie(header: string | undefined): Session | null {
  if (!header) return null;
  const part = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(\`\${COOKIE_NAME}=\`));
  if (!part) return null;
  try {
    const raw = part.slice(COOKIE_NAME.length + 1);
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Session;
  } catch {
    return null;
  }
}
`,
    },
  },
  {
    date: "2024-01-12T12:00:00Z",
    message:
      "feat: add in-memory lookup cache\n\n" +
      "Cache expensive lookup results in a process-local Map rather than Redis " +
      "because this MVP runs as a single Node process and we want zero external " +
      "cache dependency for the ₹0 path.",
    files: {
      "cache/memory-cache.ts": `const store = new Map<string, string>();

export function lookupCached(key: string, compute: (k: string) => string): string {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const value = compute(key);
  store.set(key, value);
  return value;
}

export function cacheSize(): number {
  return store.size;
}

export function clearCache(): void {
  store.clear();
}
`,
    },
  },
  {
    date: "2024-01-13T12:00:00Z",
    message:
      "feat: add postgres connection pool helper\n\n" +
      "Cap pool size explicitly so a burst of MCP tools cannot open unbounded " +
      "Postgres connections; prefer fail-loud over silent connection exhaustion.",
    files: {
      "db/pool.ts": `export type PoolOptions = {
  connectionString: string;
  /** Hard cap — never omit; default 5 for fixture demos. */
  max: number;
};

export function createPoolConfig(opts: PoolOptions): PoolOptions {
  if (!opts.connectionString.trim()) {
    throw new Error("createPoolConfig: connectionString must be non-empty");
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) {
    throw new Error("createPoolConfig: max must be a positive integer");
  }
  return { connectionString: opts.connectionString, max: opts.max };
}
`,
    },
  },
  {
    date: "2024-01-14T12:00:00Z",
    message:
      "feat: reject empty bearer tokens at the edge\n\n" +
      "Fail closed when Authorization is present but empty/whitespace — " +
      "never treat a blank bearer as anonymous open access.",
    files: {
      "auth/bearer.ts": `export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\\s+(\\S+)\\s*$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function assertBearerPresent(authorization: string | undefined): string {
  const token = extractBearerToken(authorization);
  if (!token) {
    throw new Error("missing or empty bearer token");
  }
  return token;
}
`,
    },
  },
  {
    date: "2024-01-15T12:00:00Z",
    message:
      "feat: wire health check to pool + cache stats\n\n" +
      "Expose cache size and configured pool max on /health so operators can " +
      "see process-local cache growth without attaching a debugger.",
    files: {
      "health/status.ts": `import { cacheSize } from "../cache/memory-cache.js";

export type HealthStatus = {
  ok: true;
  cacheEntries: number;
  poolMax: number;
};

export function buildHealthStatus(poolMax: number): HealthStatus {
  return { ok: true, cacheEntries: cacheSize(), poolMax };
}
`,
    },
  },
];

async function git(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, ...COMMIT_ENV_BASE, ...extraEnv },
  });
  return stdout.trim();
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

/**
 * Materialize the sample-repo git history.
 * @param opts.root - optional existing empty/temp dir; otherwise creates one under os.tmpdir()
 */
export async function buildSampleRepo(opts?: { root?: string }): Promise<SampleRepoBuild> {
  const owned = !opts?.root;
  const root = opts?.root ?? (await mkdtemp(join(tmpdir(), "codeoracle-sample-repo-")));

  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", COMMIT_ENV_BASE.GIT_AUTHOR_EMAIL]);
  await git(root, ["config", "user.name", COMMIT_ENV_BASE.GIT_AUTHOR_NAME]);
  await git(root, ["remote", "add", "origin", SAMPLE_REPO_ORIGIN]);

  const commitShas: string[] = [];

  for (const step of SAMPLE_REPO_HISTORY) {
    await writeFiles(root, step.files);
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", step.message], {
      GIT_AUTHOR_DATE: step.date,
      GIT_COMMITTER_DATE: step.date,
    });
    const sha = await git(root, ["rev-parse", "HEAD"]);
    commitShas.unshift(sha);
  }

  return {
    root,
    commitShas,
    cleanup: async () => {
      if (owned) await rm(root, { recursive: true, force: true });
    },
  };
}

/** Paths present after the full history (for golden explain_file / docs). */
export const SAMPLE_REPO_FINAL_PATHS = [
  "README.md",
  "auth/session.ts",
  "auth/bearer.ts",
  "cache/memory-cache.ts",
  "db/pool.ts",
  "health/status.ts",
] as const;

/**
 * Sync checked-in `tree/` to the final history state so humans can browse
 * the fixture without running the builder. Idempotent.
 */
export async function writeCheckedInTree(): Promise<void> {
  const treeRoot = join(SAMPLE_REPO_FIXTURE_DIR, "tree");
  await rm(treeRoot, { recursive: true, force: true });
  await mkdir(treeRoot, { recursive: true });

  const merged: Record<string, string> = {};
  for (const step of SAMPLE_REPO_HISTORY) {
    Object.assign(merged, step.files);
  }
  await writeFiles(treeRoot, merged);
}

/** Load + assert the on-disk tree matches the final history merge (CI guard). */
export async function assertCheckedInTreeMatchesHistory(): Promise<void> {
  const merged: Record<string, string> = {};
  for (const step of SAMPLE_REPO_HISTORY) {
    Object.assign(merged, step.files);
  }
  for (const [rel, expected] of Object.entries(merged)) {
    const actual = await readFile(join(SAMPLE_REPO_FIXTURE_DIR, "tree", rel), "utf8");
    if (actual !== expected) {
      throw new Error(`sample-repo tree/${rel} is out of sync with SAMPLE_REPO_HISTORY — run writeCheckedInTree()`);
    }
  }
}
