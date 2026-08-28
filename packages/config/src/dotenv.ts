import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

/** Load `.env` from the monorepo root (or a given directory). */
export function loadProjectEnv(projectRoot: string): void {
  loadDotenv({ path: resolve(projectRoot, ".env") });
}
