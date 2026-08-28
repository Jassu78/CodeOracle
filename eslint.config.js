// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

/**
 * Enforces the hexagonal boundary rule from HARD CONSTRAINT #4:
 * packages/* must never import from apps/*. Violating this is how modular
 * layouts degrade into one big app with folders.
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/drizzle/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "apps/*/src/**/*", mode: "full" },
        { type: "package", pattern: "packages/*/src/**/*", mode: "full" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "app", allow: ["app", "package"] },
            { from: "package", allow: ["package"] },
          ],
        },
      ],
      // Stub packages intentionally export an unused-looking const marker;
      // real rule strictness returns once business logic lands per-stage.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
);
