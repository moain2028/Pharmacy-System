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
    files: ["**/*.test.ts", "**/test/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" }
  }
);
