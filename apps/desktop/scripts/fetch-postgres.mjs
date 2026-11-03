#!/usr/bin/env node
/** Downloads PostgreSQL 16 Windows x64 binaries (EDB zip) + WinSW into src-tauri/resources. Verifies SHA-256 when known. */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const res = resolve(here, "../src-tauri/resources");
mkdirSync(res, { recursive: true });

const ASSETS = [
  // EDB binaries-only zip. Pin a version; update deliberately (D-023: bundled PostgreSQL).
  { name: "postgresql-16-windows-x64-binaries.zip", url: "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64-binaries.zip", sha256: null },
  { name: "winsw.exe", url: "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe", sha256: null },
];

async function download(a) {
  const dest = join(res, a.name);
  if (existsSync(dest)) { console.log(`exists ${a.name}`); return; }
  console.log(`downloading ${a.url}`);
  const r = await fetch(a.url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`${a.url} → ${r.status}`);
  await pipeline(r.body, createWriteStream(dest));
  if (a.sha256) {
    const h = createHash("sha256").update(readFileSync(dest)).digest("hex");
    if (h !== a.sha256) throw new Error(`checksum mismatch for ${a.name}: ${h}`);
  }
  console.log(`saved ${dest}`);
}
for (const a of ASSETS) await download(a);
