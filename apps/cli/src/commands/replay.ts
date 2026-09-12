import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { loadEnv, loadProjectEnv, loadProvidersConfig } from "@codeoracle/config";
import { closeDb, createDb, getRepoById } from "@codeoracle/db";
import { ProviderRegistry, createSearchRerankFn } from "@codeoracle/gateway";
import { createQdrantClient, findDecision, searchCodebase } from "@codeoracle/retrieval";
import { loadReplaySuite } from "../replay/load-suite.js";
import { scoreReplayFind, scoreReplaySearch, type CaseScore } from "../replay/score.js";

const projectRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

export type ReplayRunResult = {
  ok: boolean;
  hardFailed: number;
  softFailed: number;
  scores: CaseScore[];
};

/**
 * Live-index replay: suite JSON → retrieval tools → structural scores.
 * General engine; suite file supplies per-repo expectations.
 */
export async function runReplay(
  repoId: string,
  opts: { suite: string },
): Promise<ReplayRunResult> {
  loadProjectEnv(projectRoot);
  const env = loadEnv();
  const suitePath = resolve(projectRoot, opts.suite);
  let suite;
  try {
    suite = loadReplaySuite(suitePath);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return { ok: false, hardFailed: 0, softFailed: 0, scores: [] };
  }

  const db = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  const qdrant = createQdrantClient(env.QDRANT_URL);

  try {
    const repo = await getRepoById(db, repoId);
    if (!repo) {
      console.error(pc.red(`Repo not found: ${repoId}`));
      process.exitCode = 1;
      return { ok: false, hardFailed: 0, softFailed: 0, scores: [] };
    }
    if (repo.indexStatus !== "ready") {
      console.error(
        pc.red(
          `Repo index_status=${repo.indexStatus} — replay needs a ready index (full index first).`,
        ),
      );
      process.exitCode = 1;
      return { ok: false, hardFailed: 0, softFailed: 0, scores: [] };
    }

    const providersPath = resolve(projectRoot, env.PROVIDERS_CONFIG_PATH);
    const providers = loadProvidersConfig(providersPath, process.env);
    const gateway = new ProviderRegistry({ config: providers, env: process.env });
    const embed = async (texts: string[]) => (await gateway.embed(texts)).vectors;
    const rerankEnabled = env.SEARCH_RERANK_ENABLED;
    const rerank = createSearchRerankFn(gateway, providers, {
      enabled: rerankEnabled,
      timeoutMs: env.SEARCH_RERANK_TIMEOUT_MS,
    });

    console.log(
      pc.bold(`Replay for ${repo.githubFullName ?? repo.localClonePath ?? repoId}`) +
        pc.dim(` · ${suite.cases.length} cases · ${suitePath}\n`),
    );
    if (suite.description) {
      console.log(pc.dim(suite.description) + "\n");
    }

    const scores: CaseScore[] = [];

    for (const c of suite.cases) {
      if (c.tool === "search_codebase") {
        const out = await searchCodebase({
          db,
          qdrant,
          embed,
          repoId,
          query: c.query,
          // Final display size = hit@K; searchCodebase already over-fetches before diversify.
          topK: c.expect.hitAt,
          rerankEnabled,
          rerank,
          rerankMaxCandidates: env.SEARCH_RERANK_MAX_CANDIDATES,
          rerankTimeoutMs: env.SEARCH_RERANK_TIMEOUT_MS,
        });
        const scored = scoreReplaySearch(
          out.results.map((r) => ({
            filePath: r.filePath,
            symbolName: r.symbolName,
          })),
          c.expect,
        );
        scores.push({
          id: c.id,
          tool: c.tool,
          gate: c.gate,
          passed: scored.passed,
          detail: scored.detail,
        });
      } else {
        const out = await findDecision({
          db,
          qdrant,
          embed,
          repoId,
          topic: c.query,
        });
        const scored = scoreReplayFind(out.results, c.expect);
        scores.push({
          id: c.id,
          tool: c.tool,
          gate: c.gate,
          passed: scored.passed,
          detail: scored.detail,
        });
      }
    }

    let hardFailed = 0;
    let softFailed = 0;
    for (const s of scores) {
      const mark = s.passed ? pc.green("PASS") : s.gate === "hard" ? pc.red("FAIL") : pc.yellow("SOFT");
      console.log(`${mark}  ${pc.cyan(s.id)}  ${pc.dim(s.tool)}`);
      console.log(`      ${s.detail}`);
      if (!s.passed) {
        if (s.gate === "hard") hardFailed += 1;
        else softFailed += 1;
      }
    }

    console.log(
      "\n" +
        pc.bold(
          hardFailed === 0
            ? pc.green(`Hard gates OK (${scores.filter((s) => s.passed).length}/${scores.length} passed)`)
            : pc.red(`${hardFailed} hard gate failure(s)`),
        ) +
        (softFailed > 0 ? pc.dim(` · ${softFailed} soft miss(es)`) : ""),
    );

    const ok = hardFailed === 0;
    process.exitCode = ok ? 0 : 2;
    return { ok, hardFailed, softFailed, scores };
  } finally {
    await closeDb(env.DATABASE_URL);
  }
}
