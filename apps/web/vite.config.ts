import { defineConfig, mergeConfig } from "vitest/config";
import { defineConfig as defineViteConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const viteConfig = defineViteConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": { target: process.env["API_URL"] ?? "http://localhost:3000", changeOrigin: true } } },
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 700 },
});

export default mergeConfig(viteConfig, defineConfig({
  test: { environment: "jsdom", globals: true, setupFiles: ["./vitest.setup.ts"], css: false },
}));
