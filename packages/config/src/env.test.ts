import { describe, expect, it } from "vitest";
import { EnvValidationError, loadEnv } from "./env.js";

const validBase = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/codeoracle",
  REDIS_URL: "redis://localhost:6379",
  QDRANT_URL: "http://localhost:6333",
};

describe("loadEnv", () => {
  it("loads a valid minimal env", () => {
    const env = loadEnv(validBase as NodeJS.ProcessEnv);
    expect(env.DATABASE_URL).toBe(validBase.DATABASE_URL);
    expect(env.NODE_ENV).toBe("development"); // safe default: not a secret, not connectivity-relevant
  });

  it("throws loudly when DATABASE_URL is missing — never silently defaults", () => {
    const { DATABASE_URL: _omit, ...rest } = validBase;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it("throws loudly when REDIS_URL is missing", () => {
    const { REDIS_URL: _omit, ...rest } = validBase;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it("rejects an invalid NODE_ENV value", () => {
    expect(() => loadEnv({ ...validBase, NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });

  it("accepts optional CODEORACLE_REPO_ID when it is a uuid", () => {
    const env = loadEnv({
      ...validBase,
      CODEORACLE_REPO_ID: "9462ddb7-6064-4620-87c7-584566f643af",
    } as NodeJS.ProcessEnv);
    expect(env.CODEORACLE_REPO_ID).toBe("9462ddb7-6064-4620-87c7-584566f643af");
  });

  it("rejects non-uuid CODEORACLE_REPO_ID", () => {
    expect(() =>
      loadEnv({ ...validBase, CODEORACLE_REPO_ID: "not-a-uuid" } as NodeJS.ProcessEnv),
    ).toThrow(EnvValidationError);
  });

  it("treats empty CODEORACLE_REPO_ID as unset", () => {
    const env = loadEnv({ ...validBase, CODEORACLE_REPO_ID: "" } as NodeJS.ProcessEnv);
    expect(env.CODEORACLE_REPO_ID).toBeUndefined();
  });
});
