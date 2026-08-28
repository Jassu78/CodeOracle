import Parser from "tree-sitter";
// tree-sitter-typescript ships two grammars in one package: .typescript and .tsx
import TypeScript from "tree-sitter-typescript";
import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "../language-plugin.js";
import { hashContent } from "../hash.js";

const SYMBOL_NODE_TYPES = new Set([
  "function_declaration",
  "method_definition",
  "class_declaration",
  "interface_declaration",
  "arrow_function", // only captured when directly bound to a top-level const, see nameForNode
]);

const CLASS_LIKE_TYPES = new Set(["class_declaration"]);

function nameForNode(node: Parser.SyntaxNode): string | null {
  // function foo() {}  /  class Foo {}  /  interface Foo {}
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;

  // method inside a class: method_definition's name is a `property_identifier`
  // reachable directly as a named child in most tree-sitter-typescript versions.
  const propertyIdentifier = node.namedChildren.find((c) => c.type === "property_identifier");
  if (propertyIdentifier) return propertyIdentifier.text;

  // const foo = () => {} — only chunk this if it's a top-level lexical declaration
  if (node.type === "arrow_function" && node.parent?.type === "variable_declarator") {
    const declaratorName = node.parent.childForFieldName("name");
    if (declaratorName) return declaratorName.text;
  }

  return null;
}

/**
 * If a symbol is directly wrapped by `export` / `export default`, widen the
 * chunk's byte range to include that wrapper so the citation reflects the
 * full statement (e.g. "export function add" not just "function add") —
 * still a single syntactic unit, never spilling into an unrelated sibling.
 */
function widenToExportWrapper(node: Parser.SyntaxNode): Parser.SyntaxNode {
  const parent = node.parent;
  if (parent && (parent.type === "export_statement" || parent.type === "export_default_declaration")) {
    return parent;
  }
  return node;
}

function findEnclosingClassName(node: Parser.SyntaxNode): string | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (CLASS_LIKE_TYPES.has(current.type)) {
      const nameNode = current.childForFieldName("name");
      return nameNode ? nameNode.text : null;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Walks the tree and extracts one chunk per symbol node. Never returns a
 * chunk whose byte range starts/ends mid-body of an unrelated symbol —
 * chunk boundaries always align to a node's own start/end byte from the
 * tree-sitter parse, which by construction respects syntax boundaries.
 */
function extractChunks(filePath: string, tree: Parser.Tree, source: string): RawChunk[] {
  const chunks: RawChunk[] = [];

  function visit(node: Parser.SyntaxNode) {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      const symbolName = nameForNode(node);
      // Skip anonymous arrow functions / unnamed nodes — they are covered by
      // their enclosing named symbol instead of producing a nameless chunk.
      if (symbolName !== null) {
        const range = widenToExportWrapper(node);
        const content = source.slice(range.startIndex, range.endIndex);
        chunks.push({
          filePath,
          symbolName,
          parentSymbol: findEnclosingClassName(node),
          language: "typescript",
          byteStart: range.startIndex,
          byteEnd: range.endIndex,
          content,
          contentHash: hashContent(content),
        });
        // Don't descend into methods-within-methods double-counting; still
        // descend to catch nested named symbols (e.g. class inside function).
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(tree.rootNode);
  return chunks;
}

export const typescriptPlugin: LanguagePlugin = {
  language: "typescript",
  fileExtensions: [".ts", ".tsx"],
  chunk(filePath: string, source: string): RawChunk[] {
    const parser = new Parser();
    // Cast needed: tree-sitter-typescript's published types lag its peer
    // `tree-sitter` version (see CHANGELOG.md decision log — flagged, not
    // silently ignored). Verified at runtime by the passing boundary tests.
    const grammar = (filePath.endsWith(".tsx") ? TypeScript.tsx : TypeScript.typescript) as unknown as Parser.Language;
    parser.setLanguage(grammar);
    const tree = parser.parse(source);
    return extractChunks(filePath, tree, source);
  },
};
