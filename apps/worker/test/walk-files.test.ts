import { describe, expect, it } from "vitest";
import { buildIgnoreMatcher, isDeniedOrBinary } from "../src/crawler/walk-files.js";

describe("walk-files security filters", () => {
  it("denies .env and secret key paths", () => {
    const ig = buildIgnoreMatcher();
    expect(isDeniedOrBinary(".env", ig)).toBe(true);
    expect(isDeniedOrBinary("apps/api/.env", ig)).toBe(true);
    expect(isDeniedOrBinary("config/secrets.json", ig)).toBe(true);
    expect(isDeniedOrBinary("deploy/id_rsa", ig)).toBe(true);
  });

  it("allows normal source files", () => {
    const ig = buildIgnoreMatcher(["node_modules/"]);
    expect(isDeniedOrBinary("src/main.ts", ig)).toBe(false);
    expect(isDeniedOrBinary("README.md", ig)).toBe(false);
    expect(isDeniedOrBinary("apps/api/src/lib/auth.ts", ig)).toBe(false);
  });

  it("excludes lockfiles and ORM / eval noise classes (T9)", () => {
    const ig = buildIgnoreMatcher();
    expect(isDeniedOrBinary("pnpm-lock.yaml", ig)).toBe(true);
    expect(isDeniedOrBinary("package-lock.json", ig)).toBe(true);
    expect(isDeniedOrBinary("yarn.lock", ig)).toBe(true);
    expect(isDeniedOrBinary("Cargo.lock", ig)).toBe(true);
    expect(isDeniedOrBinary("packages/db/drizzle/meta/0006_snapshot.json", ig)).toBe(true);
    expect(isDeniedOrBinary("packages/db/drizzle/0006_fast_dreaming_celestial.sql", ig)).toBe(true);
    expect(isDeniedOrBinary("prisma/migrations/20240101_init/migration.sql", ig)).toBe(true);
    expect(isDeniedOrBinary("test/replay/suites/codeoracle-self.json", ig)).toBe(true);
    expect(isDeniedOrBinary("test/golden-queries/queries.json", ig)).toBe(true);
    // Still index real product SQL outside ORM migration trees if present.
    expect(isDeniedOrBinary("apps/api/src/lib/auth.ts", ig)).toBe(false);
  });

  it("respects gitignore patterns when provided", () => {
    const ig = buildIgnoreMatcher(["generated/"]);
    expect(isDeniedOrBinary("generated/output.ts", ig)).toBe(true);
  });
});
