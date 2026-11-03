#!/usr/bin/env node
/**
 * Builds the API + web into one Windows executable using Node Single Executable Applications (Node ≥ 20.12).
 * 1. esbuild bundles apps/api/dist/main.js (ESM → CJS) with all deps inlined (argon2/pg native parts are pure JS here:
 *    argon2 uses a prebuilt .node — copied as an asset and loaded via process.execPath dir).
 * 2. `node --experimental-sea-config` injects the blob into a copy of node.exe.
 * Run on the target OS (Windows) — SEA binaries are platform-specific.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sidecarTriple } from "./env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(here, "../src-tauri/sidecar");
mkdirSync(out, { recursive: true });
const api = join(root, "apps/api/dist/main.js");
if (!existsSync(api)) throw new Error("apps/api/dist/main.js missing — run `pnpm -w build` first");

// 1) bundle
const bundle = join(out, "api.bundle.cjs");
execSync(`npx esbuild "${api}" --bundle --platform=node --format=cjs --target=node22 --outfile="${bundle}" --external:argon2 --external:@nestjs/microservices --external:@nestjs/websockets --external:class-transformer --external:class-validator --log-level=warning`, { stdio: "inherit", cwd: root });
// argon2 ships a native addon; keep it next to the exe (resolved at runtime via NODE_PATH set by the service wrapper)
cpSync(join(root, "node_modules/argon2"), join(out, "node_modules/argon2"), { recursive: true, dereference: true });
cpSync(join(root, "node_modules/@phc"), join(out, "node_modules/@phc"), { recursive: true, dereference: true });
cpSync(join(root, "node_modules/node-addon-api"), join(out, "node_modules/node-addon-api"), { recursive: true, dereference: true });
cpSync(join(root, "node_modules/node-gyp-build"), join(out, "node_modules/node-gyp-build"), { recursive: true, dereference: true });
// web dist is served from STATIC_DIR (copied by the installer), not embedded
cpSync(join(root, "apps/web/dist"), join(out, "web"), { recursive: true });
cpSync(join(root, "packages/db/migrations"), join(out, "migrations"), { recursive: true });

// 2) SEA
const seaCfg = join(out, "sea-config.json");
writeFileSync(seaCfg, JSON.stringify({ main: bundle, output: join(out, "sea-prep.blob"), disableExperimentalSEAWarning: true, useCodeCache: true }, null, 2));
execSync(`node --experimental-sea-config "${seaCfg}"`, { stdio: "inherit" });
const triple = sidecarTriple(process.platform, process.arch);
const exe = join(out, `pharmacore-api-${triple}${process.platform === "win32" ? ".exe" : ""}`);
cpSync(process.execPath, exe);
if (process.platform === "win32") {
  try { execSync(`signtool remove /s "${exe}"`, { stdio: "ignore" }); } catch { /* unsigned node */ }
}
execSync(`npx postject "${exe}" NODE_SEA_BLOB "${join(out, "sea-prep.blob")}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${process.platform === "darwin" ? " --macho-segment-name NODE_SEA" : ""}`, { stdio: "inherit" });
console.log(`SEA built: ${exe}`);
