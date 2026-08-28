import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  ProvidersConfigSchema,
  type ProvidersConfig,
  type OpenAiCompatEndpoint,
} from "@codeoracle/contracts";

export class ProvidersConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvidersConfigError";
  }
}

/**
 * Loads providers.yaml and validates it against the shared contract schema.
 * Fails loudly on:
 *   - malformed YAML
 *   - schema violations (missing fields, wrong types)
 *   - an enabled endpoint whose apiKeyEnv is set but the referenced env var
 *     is empty (this is the "never silently default a missing secret" rule
 *     applied to providers specifically — an enabled-but-unusable endpoint
 *     must be caught at load time, not discovered as a mystery 401 later).
 */
export function loadProvidersConfig(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): ProvidersConfig {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new ProvidersConfigError(
      `Could not read providers config at ${filePath}. Copy providers.yaml.example to providers.yaml first. (${(err as Error).message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ProvidersConfigError(`Malformed YAML in ${filePath}: ${(err as Error).message}`);
  }

  const result = ProvidersConfigSchema.safeParse(parsed);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ProvidersConfigError(`Invalid providers config in ${filePath}:\n${formatted}`);
  }

  const allEndpoints = [...result.data.chat, ...result.data.embeddings];
  for (const endpoint of allEndpoints) {
    assertEnabledEndpointIsUsable(endpoint, env);
  }

  return result.data;
}

function assertEnabledEndpointIsUsable(
  endpoint: OpenAiCompatEndpoint,
  env: NodeJS.ProcessEnv,
): void {
  if (!endpoint.enabled) return;
  if (!endpoint.apiKeyEnv) return; // local endpoints (e.g. Ollama) may need no key

  const value = env[endpoint.apiKeyEnv];
  if (!value || value.trim() === "") {
    throw new ProvidersConfigError(
      `Provider "${endpoint.id}" is enabled but its API key env var "${endpoint.apiKeyEnv}" is missing or empty. ` +
        `Either set ${endpoint.apiKeyEnv} in your .env, or set enabled: false for "${endpoint.id}" in providers.yaml.`,
    );
  }
}

/** Returns enabled endpoints of a given kind, sorted by ascending priority (lower = tried first). */
export function getOrderedEndpoints(
  config: ProvidersConfig,
  kind: "chat" | "embeddings",
): OpenAiCompatEndpoint[] {
  const list = kind === "chat" ? config.chat : config.embeddings;
  return list.filter((e) => e.enabled).sort((a, b) => a.priority - b.priority);
}
