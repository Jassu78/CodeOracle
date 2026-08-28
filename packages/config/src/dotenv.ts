import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

/** Load `.env` from the monorepo root (or a given directory). */
export function loadProjectEnv(projectRoot: string): void {
  // Override empty placeholders so a blank exported GEMINI_API_KEY= does not
  // block the real value from `.env` (dotenv skips existing keys by default).
  loadDotenv({ path: resolve(projectRoot, ".env"), override: true });
}
