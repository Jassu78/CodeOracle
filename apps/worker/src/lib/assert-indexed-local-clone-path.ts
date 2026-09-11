import {
  assertLocalClonePathAllowed,
  parseAllowedRoots,
  type Env,
} from "@codeoracle/config";

/**
 * Re-apply CODEORACLE_ALLOWED_ROOTS at index time (E6 / review F2).
 * Register-time checks alone are not enough: paths can be stored in
 * development with roots unset, or retargeted via symlink after register.
 */
export function assertIndexedLocalClonePath(env: Env, localClonePath: string): string {
  return assertLocalClonePathAllowed(
    localClonePath,
    parseAllowedRoots(env.CODEORACLE_ALLOWED_ROOTS),
    { nodeEnv: env.NODE_ENV },
  );
}
