import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";

const execFileAsync = promisify(execFile);

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
};

const MIN_NODE_MAJOR = 20;
const MAX_NODE_MAJOR = 24; // engines field allows <25; keep this check in sync manually

async function checkNodeVersion(): Promise<CheckResult> {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= MIN_NODE_MAJOR && major <= MAX_NODE_MAJOR;
  return {
    name: "Node.js version",
    ok,
    detail: `v${process.versions.node} (need >=${MIN_NODE_MAJOR} <=${MAX_NODE_MAJOR})`,
    fixHint: ok ? undefined : `Install Node ${MIN_NODE_MAJOR}–${MAX_NODE_MAJOR} LTS, e.g. via nvm: nvm install ${MIN_NODE_MAJOR}`,
  };
}

async function checkDocker(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("docker", ["--version"]);
    return { name: "Docker", ok: true, detail: stdout.trim() };
  } catch {
    return {
      name: "Docker",
      ok: false,
      detail: "not found",
      fixHint: "Install Docker Desktop (macOS/Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/",
    };
  }
}

async function checkCompose(): Promise<CheckResult> {
  try {
    const { stdout } = await execFileAsync("docker", ["compose", "version"]);
    return { name: "Docker Compose", ok: true, detail: stdout.trim() };
  } catch {
    return {
      name: "Docker Compose",
      ok: false,
      detail: "not found",
      fixHint: "Docker Compose v2 ships with recent Docker Desktop/Engine. Update Docker if `docker compose version` fails.",
    };
  }
}

/**
 * Environment-check step of the `init` flow, extracted as its own `doctor`
 * command so it can be re-run any time. Currently checks Docker, Compose,
 * and Node version. Provider smoke-tests land when `@codeoracle/gateway` exists.
 */
export async function runDoctor(): Promise<boolean> {
  p.intro(pc.bold("CodeOracle — environment check"));

  const checks = await Promise.all([checkNodeVersion(), checkDocker(), checkCompose()]);

  for (const check of checks) {
    const icon = check.ok ? pc.green("✓") : pc.red("✗");
    p.log.message(`${icon} ${pc.bold(check.name)} — ${check.detail}`);
    if (!check.ok && check.fixHint) {
      p.log.warn(`  Fix: ${check.fixHint}`);
    }
  }

  const allOk = checks.every((c) => c.ok);

  if (allOk) {
    p.outro(pc.green("Environment looks good. Ready for `codeoracle init` once it lands."));
  } else {
    p.outro(pc.red("Environment is not ready — fix the items above and re-run `codeoracle doctor`."));
  }

  return allOk;
}
