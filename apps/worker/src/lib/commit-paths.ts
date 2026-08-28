import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_STAT_CHARS = 4_096;

/**
 * Ensure `sha` is readable in the local clone. Tries a one-shot shallow fetch
 * when the object is missing (common after an older depth-1 clone).
 */
export async function ensureCommitReadable(repoRoot: string, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;

  const readable = async (): Promise<boolean> => {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot });
      return true;
    } catch {
      return false;
    }
  };

  if (await readable()) return true;

  try {
    await execFileAsync("git", ["fetch", "--depth", "1", "origin", sha], {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  return readable();
}

/**
 * Deterministic changed-file list for a commit — preferred over LLM-invented paths.
 */
export async function listCommitTouchedPaths(
  repoRoot: string,
  sha: string,
): Promise<string[]> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return [];

  await ensureCommitReadable(repoRoot, sha);

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", "--name-only", "--pretty=format:", "--diff-filter=ACMRT", sha],
      { cwd: repoRoot, maxBuffer: 5 * 1024 * 1024 },
    );
    return normalizePathList(stdout.split("\n"));
  } catch {
    return [];
  }
}

/** Capped `git show --stat` for extraction context (token budget). */
export async function listCommitStatSummary(
  repoRoot: string,
  sha: string,
  maxChars = MAX_STAT_CHARS,
): Promise<string | undefined> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return undefined;
  if (!(await ensureCommitReadable(repoRoot, sha))) return undefined;

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", "--stat", "--pretty=format:", "--diff-filter=ACMRT", sha],
      { cwd: repoRoot, maxBuffer: 2 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}\n…(stat truncated)`;
  } catch {
    return undefined;
  }
}

export function normalizePathList(lines: string[]): string[] {
  return [
    ...new Set(
      lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.includes("\0")),
    ),
  ];
}

/** Read touchedPaths previously stored on github_sources.raw_json. */
export function touchedPathsFromRawJson(rawJson: unknown): string[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const paths = (rawJson as { touchedPaths?: unknown }).touchedPaths;
  if (!Array.isArray(paths)) return [];
  return normalizePathList(paths.filter((p): p is string => typeof p === "string"));
}

/** Compact path list for the extraction prompt (token budget). */
export function formatChangedPathsSummary(paths: string[], maxPaths = 40): string | undefined {
  if (paths.length === 0) return undefined;
  const shown = paths.slice(0, maxPaths);
  const extra = paths.length - shown.length;
  const lines = shown.map((p) => `- ${p}`);
  if (extra > 0) lines.push(`- …and ${extra} more`);
  return ["Changed files (from git — use these for touchedPaths; do not invent paths):", ...lines].join(
    "\n",
  );
}

/** Combine path list + optional --stat into one diffSummary blob. */
export function formatDiffSummary(opts: {
  paths: string[];
  stat?: string;
  maxPaths?: number;
}): string | undefined {
  const pathBlock = formatChangedPathsSummary(opts.paths, opts.maxPaths);
  const parts = [pathBlock, opts.stat ? `Diff stat:\n${opts.stat}` : undefined].filter(
    Boolean,
  ) as string[];
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
