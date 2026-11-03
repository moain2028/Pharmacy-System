import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "media/**", "tools/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off"
    }
  },
  {
    // Desktop build/packaging scripts are plain Node ESM (.mjs): Node globals.
    files: ["apps/desktop/scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly" } },
  },
  {
    // Domain stays fully strict. Application/infra layers deal with SQL rows and Nest modules:
    // allow `!` after explicit row checks and static-only Nest module classes.
    files: ["**/*.test.ts", "**/test/**/*.ts", "apps/**/*.ts", "packages/db/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-extraneous-class": ["error", { "allowWithDecorator": true }],
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "ignoreRestSiblings": true }]
    }
  },
  {
    // E2E tests assert on raw JSON bodies
    files: ["**/test/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" }
  }
);
