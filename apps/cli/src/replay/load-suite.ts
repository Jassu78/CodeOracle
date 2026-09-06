import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReplaySuiteSchema, type ReplaySuite } from "./suite.js";

export function loadReplaySuite(suitePath: string): ReplaySuite {
  const abs = resolve(suitePath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read replay suite ${abs}: ${msg}`);
  }
  const parsed = ReplaySuiteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid replay suite ${abs}: ${parsed.error.message}`);
  }
  return parsed.data;
}
