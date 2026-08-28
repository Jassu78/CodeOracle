import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrderedEndpoints, loadProvidersConfig, ProvidersConfigError } from "./providers.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeoracle-providers-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeYaml(contents: string): string {
  const file = join(dir, "providers.yaml");
  writeFileSync(file, contents, "utf-8");
  return file;
}

describe("loadProvidersConfig", () => {
  it("loads a valid all-local config with no API keys required", () => {
    const file = writeYaml(`
chat:
  - id: ollama-local
    kind: chat
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: qwen2.5-coder:7b
    priority: 1
    enabled: true
embeddings:
  - id: ollama-embed-local
    kind: embeddings
    baseUrl: http://localhost:11434/v1
    apiKeyEnv: null
    model: nomic-embed-text
    priority: 1
    enabled: true
`);
    const config = loadProvidersConfig(file, {});
    expect(config.chat).toHaveLength(1);
    expect(config.embeddings).toHaveLength(1);
  });

  it("fails loudly when an enabled endpoint's apiKeyEnv is missing from env", () => {
    const file = writeYaml(`
chat:
  - id: gemini-free
    kind: chat
    baseUrl: https://generativelanguage.googleapis.com/v1beta/openai
    apiKeyEnv: GEMINI_API_KEY
    model: gemini-2.5-flash
    priority: 1
    enabled: true
embeddings: []
`);
    expect(() => loadProvidersConfig(file, {})).toThrow(ProvidersConfigError);
  });

  it("does not fail for a disabled endpoint missing its API key", () => {
    const file = writeYaml(`
chat:
  - id: gemini-free
    kind: chat
    baseUrl: https://generativelanguage.googleapis.com/v1beta/openai
    apiKeyEnv: GEMINI_API_KEY
    model: gemini-2.5-flash
    priority: 1
    enabled: false
embeddings: []
`);
    expect(() => loadProvidersConfig(file, {})).not.toThrow();
  });

  it("rejects malformed YAML", () => {
    const file = writeYaml("chat: [this is not: valid: yaml:::");
    expect(() => loadProvidersConfig(file, {})).toThrow(ProvidersConfigError);
  });

  it("throws when the file does not exist", () => {
    expect(() => loadProvidersConfig(join(dir, "missing.yaml"), {})).toThrow(ProvidersConfigError);
  });

  it("getOrderedEndpoints sorts enabled endpoints by ascending priority", () => {
    const file = writeYaml(`
chat:
  - id: low-priority
    kind: chat
    baseUrl: http://a
    apiKeyEnv: null
    model: m
    priority: 3
    enabled: true
  - id: high-priority
    kind: chat
    baseUrl: http://b
    apiKeyEnv: null
    model: m
    priority: 1
    enabled: true
  - id: disabled-one
    kind: chat
    baseUrl: http://c
    apiKeyEnv: null
    model: m
    priority: 0
    enabled: false
embeddings: []
`);
    const config = loadProvidersConfig(file, {});
    const ordered = getOrderedEndpoints(config, "chat");
    expect(ordered.map((e) => e.id)).toEqual(["high-priority", "low-priority"]);
  });
});
