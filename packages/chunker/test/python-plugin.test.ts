import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pythonPlugin } from "../src/plugins/python-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "..", "fixtures", "sample.py");
const source = readFileSync(fixturePath, "utf-8");

describe("pythonPlugin — chunk boundary correctness", () => {
  const chunks = pythonPlugin.chunk(fixturePath, source);

  it("finds the expected named symbols", () => {
    const names = chunks.map((c) => c.symbolName).sort();
    expect(names).toEqual(["UserService", "__init__", "add", "add_user"].sort());
  });

  it("methods inside the class carry the correct parentSymbol", () => {
    const addUser = chunks.find((c) => c.symbolName === "add_user");
    expect(addUser?.parentSymbol).toBe("UserService");
  });

  it("module-level function has no parentSymbol and does not bleed into the class", () => {
    const add = chunks.find((c) => c.symbolName === "add");
    expect(add?.parentSymbol).toBeNull();
    expect(add!.content).not.toContain("class UserService");
  });
});
