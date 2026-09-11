import { describe, expect, it } from "vitest";
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
    const roots = parseAllowedRoots(["/tmp/allowed"]);
    expect(() =>
      assertLocalClonePathAllowed("/tmp/allowed/repo", roots, { nodeEnv: "production" }),
    ).not.toThrow();
    expect(() =>
      assertLocalClonePathAllowed("/tmp/allowed-evil/repo", roots, { nodeEnv: "production" }),
    ).toThrow(AllowedRootsError);
    expect(() =>
      assertLocalClonePathAllowed("/tmp/other/repo", roots, { nodeEnv: "production" }),
    ).toThrow(AllowedRootsError);
    expect(() =>
      assertLocalClonePathAllowed("/tmp/allowed/../other", roots, { nodeEnv: "development" }),
    ).toThrow(AllowedRootsError);
  });
});
