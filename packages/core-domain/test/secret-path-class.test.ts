import { describe, expect, it } from "vitest";
import {
  contentLooksLikeSecretMaterial,
  isDotenvSecretBasename,
  isSecretIndexedPath,
  mustRefuseSecretRetrieval,
} from "../src/secret-path-class.js";

describe("secret-path-class", () => {
  it("denies .env2-class basenames and allows env.ts", () => {
    expect(isDotenvSecretBasename(".env")).toBe(true);
    expect(isDotenvSecretBasename(".env2")).toBe(true);
    expect(isDotenvSecretBasename(".env.local")).toBe(true);
    expect(isDotenvSecretBasename(".env.staging.local")).toBe(true);
    expect(isDotenvSecretBasename("env.ts")).toBe(false);
    expect(isDotenvSecretBasename("environment.ts")).toBe(false);
    // Not dotenv secret stores (F4) — do not over-deny.
    expect(isDotenvSecretBasename(".envoy")).toBe(false);
    expect(isDotenvSecretBasename(".environment")).toBe(false);
    expect(isDotenvSecretBasename(".envrc")).toBe(false);

    expect(isSecretIndexedPath("Chatbot-Api/.env2")).toBe(true);
    expect(isSecretIndexedPath("apps/api/.env")).toBe(true);
    expect(isSecretIndexedPath("src/config/env.ts")).toBe(false);
    expect(isSecretIndexedPath("packages/config/src/env.ts")).toBe(false);
    expect(isSecretIndexedPath("vendor/.envoy")).toBe(false);
    expect(isSecretIndexedPath("apps/.environment")).toBe(false);
  });

  it("denies key/credential path classes", () => {
    expect(isSecretIndexedPath("deploy/id_rsa")).toBe(true);
    expect(isSecretIndexedPath("certs/server.pem")).toBe(true);
    expect(isSecretIndexedPath("config/secrets.json")).toBe(true);
    expect(isSecretIndexedPath(".aws/credentials")).toBe(true);
    expect(isSecretIndexedPath("apps/api/src/lib/auth.ts")).toBe(false);
  });

  it("flags high-confidence secret payloads", () => {
    expect(contentLooksLikeSecretMaterial("mongodb+srv://user:pass@cluster/db")).toBe(true);
    expect(contentLooksLikeSecretMaterial("See docs: mongodb://localhost:27017/mydb")).toBe(false);
    expect(contentLooksLikeSecretMaterial("LANGFUSE_SECRET_KEY=abcdefghijklmnop")).toBe(true);
    expect(contentLooksLikeSecretMaterial("GEMINI_API_KEY=AIzaSyDummyValue123456")).toBe(true);
    expect(contentLooksLikeSecretMaterial("export function verifyGitHubSignature() {}")).toBe(false);
  });

  it("mustRefuseSecretRetrieval combines path and content", () => {
    expect(mustRefuseSecretRetrieval(".env2", "OK=1")).toBe(true);
    expect(mustRefuseSecretRetrieval("src/main.ts", "mongodb+srv://user:pass@cluster/db")).toBe(true);
    expect(mustRefuseSecretRetrieval("src/main.ts", "const x = 1")).toBe(false);
  });
});
