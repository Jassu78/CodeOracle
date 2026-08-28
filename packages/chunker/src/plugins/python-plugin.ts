import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import type { RawChunk } from "@codeoracle/contracts";
import type { LanguagePlugin } from "../language-plugin.js";
import { hashContent } from "../hash.js";

const SYMBOL_NODE_TYPES = new Set(["function_definition", "class_definition"]);

function nameForNode(node: Parser.SyntaxNode): string | null {
  const nameNode = node.childForFieldName("name");
  return nameNode ? nameNode.text : null;
}

function findEnclosingClassName(node: Parser.SyntaxNode): string | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "class_definition") {
      const nameNode = current.childForFieldName("name");
      return nameNode ? nameNode.text : null;
    }
    current = current.parent;
  }
  return null;
}

function extractChunks(filePath: string, tree: Parser.Tree, source: string): RawChunk[] {
  const chunks: RawChunk[] = [];

  function visit(node: Parser.SyntaxNode) {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      const symbolName = nameForNode(node);
      if (symbolName !== null) {
        const content = source.slice(node.startIndex, node.endIndex);
        chunks.push({
          filePath,
          symbolName,
          parentSymbol: findEnclosingClassName(node),
          language: "python",
          byteStart: node.startIndex,
          byteEnd: node.endIndex,
          content,
          contentHash: hashContent(content),
        });
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(tree.rootNode);
  return chunks;
}

export const pythonPlugin: LanguagePlugin = {
  language: "python",
  fileExtensions: [".py"],
  chunk(filePath: string, source: string): RawChunk[] {
    const parser = new Parser();
    parser.setLanguage(Python as unknown as Parser.Language);
    const tree = parser.parse(source);
    return extractChunks(filePath, tree, source);
  },
};
