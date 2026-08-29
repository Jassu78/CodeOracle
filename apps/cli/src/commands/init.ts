import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { runDoctor } from "./doctor.js";
import { runMcpConfig } from "./mcp-config.js";
import { runRepoIndex, runRepoRegister } from "./repo.js";

const projectRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

function ensureFileFromExample(target: string, example: string, label: string): boolean {
  const targetPath = resolve(projectRoot, target);
  if (existsSync(targetPath)) return false;
  const examplePath = resolve(projectRoot, example);
  copyFileSync(examplePath, targetPath);
  p.log.step(`Created ${pc.cyan(target)} from ${example} — ${label}`);
  return true;
}

/**
 * `codeoracle init` — the guided flow from architecture-design.md §8,
 * collapsed to what's actually implementable without a provider smoke-test
 * or a TUI dashboard: check the environment, scaffold config files, register
 * one repo, queue its first index, and print a ready-to-paste MCP config.
 * Re-runnable — every step is a no-op if already done.
 */
export async function runInit(): Promise<void> {
  p.intro(pc.bold("CodeOracle — init"));

  const envOk = await runDoctor();
  if (!envOk) {
    p.outro(pc.red("Fix the environment issues above, then re-run `codeoracle init`."));
    process.exitCode = 1;
    return;
  }

  const createdEnv = ensureFileFromExample(".env", ".env.example", "fill in DATABASE_URL/REDIS_URL/QDRANT_URL if not using defaults");
  const createdProviders = ensureFileFromExample(
    "providers.yaml",
    "providers.yaml.example",
    "enable at least one chat + one embeddings endpoint",
  );

  if (createdEnv || createdProviders) {
    p.log.warn(
      "New config file(s) were created from the .example templates. Edit them now (API keys, GitHub PAT), then re-run `codeoracle init`.",
    );
    p.outro(pc.yellow("Paused for config — re-run once .env / providers.yaml are filled in."));
    return;
  }

  p.log.step("Checking that Postgres/Redis/Qdrant are reachable...");
  const { loadEnv, loadProjectEnv } = await import("@codeoracle/config");
  loadProjectEnv(projectRoot);
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch (err) {
    p.log.error((err as Error).message);
    p.outro(pc.red("Invalid .env — fix the issue above and re-run `codeoracle init`."));
    process.exitCode = 1;
    return;
  }

  const { createDb, pingDatabase } = await import("@codeoracle/db");
  try {
    await pingDatabase(createDb(env.DATABASE_URL, env.DB_POOL_MAX));
  } catch (err) {
    p.log.error(`Could not reach Postgres at DATABASE_URL: ${(err as Error).message}`);
    p.outro(pc.red("Run `cd infra/compose && docker compose up -d`, then re-run `codeoracle init`."));
    process.exitCode = 1;
    return;
  }

  const target = await p.select({
    message: "Register which repo?",
    options: [
      { value: "github", label: "GitHub repo (needs GITHUB_PAT in .env)" },
      { value: "local", label: "Local git mirror (offline, no PAT)" },
    ],
  });
  if (p.isCancel(target)) {
    p.cancel("Cancelled.");
    return;
  }

  let repoId: string;
  if (target === "github") {
    const githubFullName = await p.text({
      message: "GitHub repo (owner/name):",
      placeholder: "your-org/your-repo",
      validate: (v) => (v.includes("/") ? undefined : "Expected owner/name"),
    });
    if (p.isCancel(githubFullName)) {
      p.cancel("Cancelled.");
      return;
    }
    const branch = await p.text({ message: "Default branch:", initialValue: "main" });
    if (p.isCancel(branch)) {
      p.cancel("Cancelled.");
      return;
    }
    repoId = await registerAndReturnId({ github: githubFullName, branch });
  } else {
    const localPath = await p.text({
      message: "Absolute path to the local git repo:",
      placeholder: "/Users/you/code/your-repo",
    });
    if (p.isCancel(localPath)) {
      p.cancel("Cancelled.");
      return;
    }
    repoId = await registerAndReturnId({ localPath });
  }

  const spin = p.spinner();
  spin.start("Queuing full index");
  await runRepoIndex(repoId);
  spin.stop("Full index queued");

  p.log.message("");
  p.log.warn(
    "Start a worker to actually process the index (separate terminal): pnpm worker",
  );
  p.log.message("Once `pnpm cli repo status " + repoId + "` shows index_status=ready:");
  await runMcpConfig(repoId);

  p.outro(pc.green(`Done. Repo ${repoId} queued — connect your editor once indexing finishes.`));
}

async function registerAndReturnId(opts: {
  github?: string;
  branch?: string;
  localPath?: string;
}): Promise<string> {
  // runRepoRegister opens and closes its own DB pool (see commands/repo.ts).
  // Look up the id with a fresh connection AFTER it returns, rather than
  // holding a `db` handle across that call — the pool it closes is shared
  // per DATABASE_URL, so reusing a pre-existing handle here would be reading
  // from an already-`.end()`ed client.
  await runRepoRegister(opts);

  const { loadEnv, loadProjectEnv } = await import("@codeoracle/config");
  const { closeDb, createDb, getRepoByGithubFullName } = await import("@codeoracle/db");
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  try {
    const githubFullName = opts.github ?? `local/${opts.localPath!.split("/").pop() ?? "repo"}`;
    const row = await getRepoByGithubFullName(db, githubFullName);
    if (!row) throw new Error(`Registered ${githubFullName} but could not look it up afterward`);
    return row.id;
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}
