#!/usr/bin/env node
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runDecisionsExtract, runDecisionsReview } from "./commands/decisions.js";
import { runRepoIndex, runRepoRecover, runRepoRegister, runRepoStatus } from "./commands/repo.js";

const program = new Command();

program
  .name("codeoracle")
  .description("Self-hosted MCP server that searches your code and remembers why it's built that way.")
  .version("0.0.0");

program
  .command("doctor")
  .description("Check local environment (Docker, Compose, Node version) before running CodeOracle.")
  .action(async () => {
    const ok = await runDoctor();
    process.exitCode = ok ? 0 : 1;
  });

// `init`, `status`, `mcp-config` are scaffolded in later stages once
// packages/gateway, packages/db, and the compose stack are wired together.
// Registering stub commands now keeps `--help` honest about current scope
// instead of pretending they exist.
program
  .command("init")
  .description("[not yet implemented]")
  .action(() => {
    console.log("`codeoracle init` is not implemented yet. Run `codeoracle doctor` for now.");
    process.exitCode = 1;
  });

const repo = program.command("repo").description("Register repositories and queue indexing jobs.");

repo
  .command("register")
  .description("Register a GitHub repo or local mirror for indexing.")
  .option("--github <fullName>", "GitHub owner/repo (uses GITHUB_PAT from .env)")
  .option("--local-path <path>", "Absolute path to a local git mirror (offline, no company PAT)")
  .option("--name <name>", "Name for local repos (default: directory basename)")
  .option("--branch <branch>", "Default branch", "main")
  .action(async (opts: { github?: string; localPath?: string; name?: string; branch?: string }) => {
    await runRepoRegister({
      github: opts.github,
      branch: opts.branch,
      localPath: opts.localPath,
      name: opts.name,
    });
  });

repo
  .command("index")
  .description("Queue a full index job for a registered repo.")
  .argument("<repoId>", "Repo UUID from `repo register`")
  .action(async (repoId: string) => {
    await runRepoIndex(repoId);
  });

repo
  .command("recover")
  .description("Recover a repo stuck in indexing (reconcile Redis counter vs queue).")
  .argument("<repoId>", "Repo UUID from `repo register`")
  .action(async (repoId: string) => {
    await runRepoRecover(repoId);
  });

repo
  .command("status")
  .description("Show index status and chunk counts for a registered repo.")
  .argument("<repoId>", "Repo UUID from `repo register`")
  .action(async (repoId: string) => {
    await runRepoStatus(repoId);
  });

const decisions = program.command("decisions").description("Inspect extracted architectural decisions.");

decisions
  .command("review")
  .description("Print stored decisions for manual QA (D3.5).")
  .argument("<repoId>", "Repo UUID from `repo register`")
  .action(async (repoId: string) => {
    await runDecisionsReview(repoId);
  });

decisions
  .command("extract")
  .description("Queue extract_decisions jobs (optional --clear of stored decisions).")
  .argument("<repoId>", "Repo UUID from `repo register`")
  .option("--clear", "Delete existing decisions for this repo before queuing")
  .option(
    "--limit <n>",
    "Queue at most N sources (PRs first). Overrides EXTRACT_QUEUE_LIMIT.",
    (v: string) => Number.parseInt(v, 10),
  )
  .action(async (repoId: string, opts: { clear?: boolean; limit?: number }) => {
    await runDecisionsExtract(repoId, {
      clear: Boolean(opts.clear),
      limit: Number.isFinite(opts.limit) ? opts.limit : undefined,
    });
  });

program.parse();
