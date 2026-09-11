import { describe, expect, it } from "vitest";
import { findAtxHeadings, markdownPlugin } from "../src/plugins/markdown-plugin.js";
import { textPlugin } from "../src/plugins/text-plugin.js";
import { chunkFile } from "../src/registry.js";

describe("markdownPlugin", () => {
  it("chunks by ATX headings with symbolName = title", () => {
    const source = [
      "Intro line.",
      "",
      "# Auth",
      "Use API tokens.",
      "",
      "## Refresh",
      "Rotate weekly.",
      "",
    ].join("\n");

    const chunks = markdownPlugin.chunk("docs/auth.md", source);
    expect(chunks[0]!.symbolName).toBeNull();
    expect(chunks[0]!.content).toContain("Intro line.");
    expect(chunks.map((c) => c.symbolName)).toEqual([null, "Auth", "Refresh"]);
    expect(chunks[1]!.content.trimStart().startsWith("# Auth")).toBe(true);
    expect(chunks[2]!.content).toContain("Rotate weekly.");
    expect(chunks.every((c) => c.language === "markdown")).toBe(true);
  });

  it("does not treat lone # or next-line text as a heading title", () => {
    const source = "#\n## Real Title\nbody\n";
    expect(findAtxHeadings(source).map((h) => h.title)).toEqual(["Real Title"]);
    const chunks = markdownPlugin.chunk("edge.md", source);
    expect(chunks.map((c) => c.symbolName)).toEqual([null, "Real Title"]);
  });

  it("skips whitespace-only ATX titles", () => {
    expect(findAtxHeadings("##   \n# Real\n").map((h) => h.title)).toEqual(["Real"]);
  });

  it("strips CommonMark closing hash sequences from titles", () => {
    expect(findAtxHeadings("# Foo ##\n").map((h) => h.title)).toEqual(["Foo"]);
    expect(findAtxHeadings("## Bar ###\n").map((h) => h.title)).toEqual(["Bar"]);
  });

  it("sets parentSymbol from the nearest lower-depth heading", () => {
    const source = ["# A", "a", "## B", "b", "### C", "c", "## D", "d", "# E", "e", ""].join(
      "\n",
    );
    const chunks = markdownPlugin.chunk("nest.md", source).filter((c) => c.symbolName);
    expect(chunks.map((c) => [c.symbolName, c.parentSymbol])).toEqual([
      ["A", null],
      ["B", "A"],
      ["C", "B"],
      ["D", "A"],
      ["E", null],
    ]);
  });

  it("ignores ATX-looking lines inside fenced code", () => {
    const source = ["Before", "", "```", "# Fake", "code", "```", "", "# Real", "ok", ""].join(
      "\n",
    );
    expect(findAtxHeadings(source).map((h) => h.title)).toEqual(["Real"]);
    const chunks = markdownPlugin.chunk("fence.md", source);
    expect(chunks.map((c) => c.symbolName)).toEqual([null, "Real"]);
  });

  it("window-splits a huge section without dropping bytes", () => {
    const body = "x".repeat(5000);
    const source = `# Huge\n${body}`;
    const chunks = markdownPlugin.chunk("big.md", source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.byteStart).toBe(0);
    expect(chunks[chunks.length - 1]!.byteEnd).toBe(source.length);
    expect(chunks.every((c) => c.symbolName === "Huge")).toBe(true);
  });

  it("registry routes .md / .mdx / .markdown (case-insensitive)", () => {
    expect(chunkFile("README.md", "# Hello\nworld\n")[0]!.language).toBe("markdown");
    expect(chunkFile("x.MDX", "# Hello\n")[0]!.language).toBe("markdown");
    expect(chunkFile("doc.Markdown", "# Hello\n")[0]!.language).toBe("markdown");
    expect(chunkFile("README.md", "# Hello\nworld\n")[0]!.symbolName).toBe("Hello");
  });
});

describe("textPlugin", () => {
  it("merges paragraphs under the soft target", () => {
    const source = "para one.\n\npara two.\n\npara three.\n";
    const chunks = textPlugin.chunk("notes.txt", source);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.language).toBe("text");
    expect(chunks[0]!.content).toContain("para one.");
    expect(chunks[0]!.content).toContain("para three.");
  });

  it("flushes when cumulative paragraphs exceed the soft target", () => {
    const a = "a".repeat(1000);
    const b = "b".repeat(1000);
    const source = `${a}\n\n${b}\n`;
    const chunks = textPlugin.chunk("split.txt", source);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.content).toContain("a");
    expect(chunks[1]!.content).toContain("b");
    expect(chunks[0]!.byteEnd).toBeLessThanOrEqual(chunks[1]!.byteStart);
  });

  it("covers full source for long unbroken text", () => {
    const source = "y".repeat(4500);
    const chunks = textPlugin.chunk("blob.txt", source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.byteStart).toBe(0);
    expect(chunks[chunks.length - 1]!.byteEnd).toBe(source.length);
  });

  it("registry routes .txt / .rst / .adoc (case-insensitive)", () => {
    expect(chunkFile("notes.txt", "hello prose\n")[0]!.language).toBe("text");
    expect(chunkFile("a.RST", "hello\n")[0]!.language).toBe("text");
    expect(chunkFile("b.Adoc", "hello\n")[0]!.language).toBe("text");
  });
});
