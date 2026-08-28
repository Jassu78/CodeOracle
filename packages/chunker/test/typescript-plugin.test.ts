import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../src/plugins/typescript-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "fixtures", "sample.ts");
const source = readFileSync(fixturePath, "utf-8");

describe("typescriptPlugin — chunk boundary correctness", () => {
  const chunks = typescriptPlugin.chunk(fixturePath, source);

  it("finds the expected named symbols", () => {
    const names = chunks.map((c) => c.symbolName).sort();
    expect(names).toEqual(
      ["Greeter", "UserService", "add", "addUser", "greet", "multiply"].sort(),
    );
  });

  it("each chunk's content starts and ends exactly at the symbol's own boundary, not mid-body", () => {
    const addChunk = chunks.find((c) => c.symbolName === "add" && c.parentSymbol === null);
    expect(addChunk).toBeDefined();
    // Widened to include the `export` wrapper (full statement), never a partial/truncated symbol.
    expect(addChunk!.content.trimStart().startsWith("export function add")).toBe(true);
    // Must end with the closing brace of THIS function, not spill into the next.
    expect(addChunk!.content.trimEnd().endsWith("}")).toBe(true);
    expect(addChunk!.content).not.toContain("export class UserService");
  });

  it("interface chunk includes its export wrapper and stops before the next symbol", () => {
    const greeter = chunks.find((c) => c.symbolName === "Greeter");
    expect(greeter!.content.trimStart().startsWith("export interface Greeter")).toBe(true);
    expect(greeter!.content).not.toContain("export function add");
  });

  it("methods inside a class carry the correct parentSymbol", () => {
    const greet = chunks.find((c) => c.symbolName === "greet");
    const addUser = chunks.find((c) => c.symbolName === "addUser");
    expect(greet?.parentSymbol).toBe("UserService");
    expect(addUser?.parentSymbol).toBe("UserService");
  });

  it("top-level function and interface have no parentSymbol", () => {
    const add = chunks.find((c) => c.symbolName === "add" && c.parentSymbol === null);
    const greeter = chunks.find((c) => c.symbolName === "Greeter");
    expect(add?.parentSymbol).toBeNull();
    expect(greeter?.parentSymbol).toBeNull();
  });

  it("a top-level arrow function bound to a const is captured with its declared name", () => {
    const multiply = chunks.find((c) => c.symbolName === "multiply");
    expect(multiply).toBeDefined();
    expect(multiply!.content).toContain("a * b");
  });

  it("no two chunks' byte ranges for distinct top-level symbols overlap", () => {
    const topLevel = chunks.filter((c) => c.parentSymbol === null);
    for (let i = 0; i < topLevel.length; i++) {
      for (let j = i + 1; j < topLevel.length; j++) {
        const a = topLevel[i]!;
        const b = topLevel[j]!;
        const overlaps = a.byteStart < b.byteEnd && b.byteStart < a.byteEnd;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("every chunk has a stable content hash", () => {
    for (const chunk of chunks) {
      expect(chunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
