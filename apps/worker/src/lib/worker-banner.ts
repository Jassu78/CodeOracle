import { execSync } from "node:child_process";

export function resolveGitSha(cwd: string): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function logWorkerStartup(opts: { cwd: string; concurrency: number }): void {
  const sha = resolveGitSha(opts.cwd);
  console.log(
    `CodeOracle worker pid=${process.pid} sha=${sha} concurrency=${opts.concurrency}`,
  );
}
