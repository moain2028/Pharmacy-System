import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8", reporter: ["text", "lcov"], include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { statements: 99, branches: 97, functions: 99, lines: 99 }
    }
  }
});
