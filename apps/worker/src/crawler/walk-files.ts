import { access } from "node:fs/promises";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, relative } from "node:path";
import ignore, { type Ignore } from "ignore";

const execFileAsync = promisify(execFile);

const DEFAULT_EXCLUDES = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "coverage/",
  ".turbo/",
  ".next/",
  "vendor/",
  "__pycache__/",
  // Lockfiles — lexical dumps of the whole dependency graph; pollute hybrid search.
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "Gemfile.lock",
  // ORM machine output (schema snapshots / generated migration SQL).
  "**/drizzle/meta/",
  "**/drizzle/**/*.sql",
  "**/prisma/migrations/",
  "**/*_snapshot.json",
  // Eval / golden fixtures that embed the queries themselves (self-hit pollution).
  "**/replay/suites/",
  "**/golden-queries/**/queries.json",
];

/** Paths that must never be indexed even if not gitignored. */
export const SECRET_DENYLIST = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/credentials.json",
  "**/secrets.json",
  "**/secrets.yaml",
  "**/secrets.yml",
  ".npmrc",
  "**/.aws/credentials",
];

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".wasm",
  ".mp4",
  ".mp3",
  ".lock",
]);

const MAX_FILE_BYTES = 512_000;

export function buildIgnoreMatcher(extraPatterns: string[] = []): Ignore {
  const ig = ignore();
  ig.add(DEFAULT_EXCLUDES);
  ig.add(SECRET_DENYLIST);
  ig.add(extraPatterns);
  return ig;
}

export function isDeniedOrBinary(relPath: string, ig: Ignore): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  if (ig.ignores(normalized)) return true;
  const ext = normalized.includes(".") ? normalized.slice(normalized.lastIndexOf(".")).toLowerCase() : "";
  return BINARY_EXT.has(ext);
}

async function loadGitignorePatterns(rootDir: string): Promise<string[]> {
  const patterns: string[] = [];
  try {
    const content = await readFile(join(rootDir, ".gitignore"), "utf-8");
    patterns.push(content);
  } catch {
    // no root .gitignore
  }
  return patterns;
}

async function listTrackedFiles(rootDir: string, ig: Ignore): Promise<string[] | null> {
  try {
    await access(join(rootDir, ".git"));
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: rootDir });
    const files = stdout.split("\0").filter(Boolean);
    const out: string[] = [];
    for (const filePath of files) {
      if (isDeniedOrBinary(filePath, ig)) continue;
      const info = await stat(join(rootDir, filePath));
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
      out.push(filePath);
    }
    return out.sort();
  } catch {
    return null;
  }
}

async function walkUntracked(rootDir: string, ig: Ignore): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(rootDir, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (ig.ignores(`${rel}/`)) continue;
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isDeniedOrBinary(rel, ig)) continue;
      const info = await stat(abs);
      if (info.size > MAX_FILE_BYTES) continue;
      out.push(rel);
    }
  }

  await walk(rootDir);
  return out.sort();
}

/**
 * List text files to index under a repo root.
 *
 * Filters: root `.gitignore` + hard excludes (build dirs, lockfiles, ORM meta,
 * eval suite JSON, secrets) + binary extensions + size cap. Hard excludes apply
 * even when files are git-tracked — they are index-noise classes, not “this repo”.
 */
export async function listSourceFiles(rootDir: string): Promise<string[]> {
  const gitignorePatterns = await loadGitignorePatterns(rootDir);
  const ig = buildIgnoreMatcher(gitignorePatterns);
  const tracked = await listTrackedFiles(rootDir, ig);
  if (tracked) return tracked;
  return walkUntracked(rootDir, ig);
}

export async function readRepoFile(rootDir: string, filePath: string): Promise<string> {
  return readFile(join(rootDir, filePath), "utf-8");
}

export async function resolveRepoHeadSha(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return stdout.trim();
  } catch {
    return "full-index";
  }
}
