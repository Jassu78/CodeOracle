import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";
import {
  AllowedRootsError,
  DEV_SECRET_PLACEHOLDER,
  ProductionSafetyError,
  assertLocalClonePathAllowed,
  assertProductionSafety,
  effectiveBindHost,
  isLoopbackBindHost,
  parseAllowedRoots,
} from "./production-guards.js";

const validBase = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/codeoracle",
  REDIS_URL: "redis://localhost:6379",
  QDRANT_URL: "http://localhost:6333",
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("production guards", () => {
  it("treats unset API_HOST as all-interfaces for safety", () => {
    expect(effectiveBindHost(undefined)).toBe("0.0.0.0");
    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
  });

  it("allows development with placeholder secrets", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "development",
      DATABASE_URL: `postgresql://codeoracle:${DEV_SECRET_PLACEHOLDER}@localhost:5432/codeoracle`,
    } as NodeJS.ProcessEnv);
    expect(() => assertProductionSafety(env, { bindHosts: ["0.0.0.0"] })).not.toThrow();
  });

  it("refuses placeholder DATABASE_URL in production", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      DATABASE_URL: `postgresql://codeoracle:${DEV_SECRET_PLACEHOLDER}@localhost:5432/codeoracle`,
      API_TOKEN: "real-token",
    } as NodeJS.ProcessEnv);
    expect(() => assertProductionSafety(env, { bindHosts: ["127.0.0.1"] })).toThrow(
      ProductionSafetyError,
    );
  });

  it("refuses placeholder webhook secret in production", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      GITHUB_WEBHOOK_SECRET: DEV_SECRET_PLACEHOLDER,
      API_TOKEN: "real-token",
    } as NodeJS.ProcessEnv);
    expect(() => assertProductionSafety(env, { bindHosts: ["127.0.0.1"] })).toThrow(
      ProductionSafetyError,
    );
  });

  it("refuses empty API_TOKEN on non-loopback API bind in production", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "api" }),
    ).toThrow(ProductionSafetyError);
    expect(() =>
      assertProductionSafety(env, {
        bindHosts: [effectiveBindHost(undefined)],
        bindKind: "api",
      }),
    ).toThrow(ProductionSafetyError);
  });

  it("does not treat MCP_HTTP_BEARER_TOKEN as enough for API bind (E6)", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      MCP_HTTP_BEARER_TOKEN: "mcp-only",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "api" }),
    ).toThrow(ProductionSafetyError);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "mcp" }),
    ).not.toThrow();
  });

  it("allows production on loopback without API_TOKEN", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["127.0.0.1"], bindKind: "api" }),
    ).not.toThrow();
    expect(() => assertProductionSafety(env, { bindHosts: [] })).not.toThrow();
  });

  it("allows production non-loopback API when API_TOKEN is set", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      API_TOKEN: "prod-token",
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "api" }),
    ).not.toThrow();
  });

  it("refuses placeholder API_TOKEN in production even on non-loopback (F3)", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      API_TOKEN: DEV_SECRET_PLACEHOLDER,
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "api" }),
    ).toThrow(ProductionSafetyError);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["127.0.0.1"], bindKind: "api" }),
    ).toThrow(ProductionSafetyError);
  });

  it("refuses placeholder MCP_HTTP_BEARER_TOKEN in production (F3)", () => {
    const env = loadEnv({
      ...validBase,
      NODE_ENV: "production",
      MCP_HTTP_BEARER_TOKEN: `  ${DEV_SECRET_PLACEHOLDER}  `,
    } as NodeJS.ProcessEnv);
    expect(() =>
      assertProductionSafety(env, { bindHosts: ["0.0.0.0"], bindKind: "mcp" }),
    ).toThrow(ProductionSafetyError);
  });
});

describe("CODEORACLE_ALLOWED_ROOTS", () => {
  it("parses comma-separated roots from env", () => {
    const env = loadEnv({
      ...validBase,
      CODEORACLE_ALLOWED_ROOTS: "/tmp/a, /tmp/b",
    } as NodeJS.ProcessEnv);
    expect(env.CODEORACLE_ALLOWED_ROOTS).toEqual(["/tmp/a", "/tmp/b"]);
    expect(parseAllowedRoots(env.CODEORACLE_ALLOWED_ROOTS).length).toBe(2);
  });

  it("allows any path in development when roots unset", () => {
    const abs = assertLocalClonePathAllowed("/tmp/whatever", [], { nodeEnv: "development" });
    expect(abs).toContain("whatever");
  });

  it("requires roots in production", () => {
    expect(() =>
      assertLocalClonePathAllowed("/tmp/whatever", [], { nodeEnv: "production" }),
    ).toThrow(AllowedRootsError);
  });

  it("jails paths under configured roots and rejects prefix siblings", () => {
    const base = makeTempDir("co-roots-");
    const allowed = join(base, "allowed");
    const evilSibling = join(base, "allowed-evil");
    const other = join(base, "other");
    mkdirSync(join(allowed, "repo"), { recursive: true });
    mkdirSync(join(evilSibling, "repo"), { recursive: true });
    mkdirSync(join(other, "repo"), { recursive: true });

    const roots = parseAllowedRoots([allowed]);
    expect(() =>
      assertLocalClonePathAllowed(join(allowed, "repo"), roots, { nodeEnv: "production" }),
    ).not.toThrow();
    expect(() =>
      assertLocalClonePathAllowed(join(evilSibling, "repo"), roots, { nodeEnv: "production" }),
    ).toThrow(AllowedRootsError);
    expect(() =>
      assertLocalClonePathAllowed(join(other, "repo"), roots, { nodeEnv: "development" }),
    ).toThrow(AllowedRootsError);
    expect(() =>
      assertLocalClonePathAllowed(join(allowed, "..", "other", "repo"), roots, {
        nodeEnv: "development",
      }),
    ).toThrow(AllowedRootsError);
  });

  it("refuses symlink escape under an allowed root (F1)", () => {
    const base = makeTempDir("co-jail-");
    const allowed = join(base, "allowed");
    const outside = join(base, "outside");
    mkdirSync(allowed, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "nope");

    const escapeLink = join(allowed, "escape");
    symlinkSync(outside, escapeLink);

    const roots = parseAllowedRoots([allowed]);
    expect(() =>
      assertLocalClonePathAllowed(escapeLink, roots, { nodeEnv: "production" }),
    ).toThrow(AllowedRootsError);

    // Lexical path looks inside the jail; realpath must still refuse.
    const lexical = join(allowed, "escape");
    expect(lexical.startsWith(allowed)).toBe(true);
    expect(() =>
      assertLocalClonePathAllowed(lexical, roots, { nodeEnv: "development" }),
    ).toThrow(AllowedRootsError);
  });

  it("returns realpath for an in-jail directory", () => {
    const base = makeTempDir("co-ok-");
    const allowed = join(base, "allowed");
    const repo = join(allowed, "repo");
    mkdirSync(repo, { recursive: true });
    const roots = parseAllowedRoots([allowed]);
    const out = assertLocalClonePathAllowed(repo, roots, { nodeEnv: "production" });
    expect(out).toBe(realpathSync(repo));
  });
});
