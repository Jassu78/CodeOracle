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
  });

  it("respects gitignore patterns when provided", () => {
    const ig = buildIgnoreMatcher(["generated/"]);
    expect(isDeniedOrBinary("generated/output.ts", ig)).toBe(true);
  });
});
