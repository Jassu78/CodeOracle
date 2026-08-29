/**
 * @deprecated Prefer `buildSampleRepo` from `test/fixtures/sample-repo/build.ts`.
 * Thin wrapper kept so existing e2e imports keep working — one source of truth
 * for the D5.1 fixture history.
 */
export {
  buildSampleRepo as buildSampleGitRepo,
  type SampleRepoBuild as SampleRepo,
} from "../../fixtures/sample-repo/build.js";
