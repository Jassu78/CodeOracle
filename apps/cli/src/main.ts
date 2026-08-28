#!/usr/bin/env node
import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";

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

program.parse();
