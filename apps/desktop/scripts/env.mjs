/** Pure helpers shared by the packaging scripts; unit-tested. */

/** Parses a KEY=VALUE .env text into a map (ignores comments/blank lines; keeps `=` inside values).
 * @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Splits a postgres:// URL into libpq env vars (what pg_dump/pg_restore/psql read).
 * @param {string} url */
export function pgEnvFromUrl(url) {
  const u = new URL(url);
  return { PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.replace(/^\//, "") };
}

/** Rust target triple suffix Tauri expects for externalBin sidecars.
 * @param {string} platform @param {string} [arch] */
export function sidecarTriple(platform, arch = "x64") {
  const a = arch === "arm64" ? "aarch64" : "x86_64";
  if (platform === "win32") return `${a}-pc-windows-msvc`;
  if (platform === "darwin") return `${a}-apple-darwin`;
  return `${a}-unknown-linux-gnu`;
}

/** Backup file name convention shared with the API (`pharmacore-YYYYMMDD-HHMMSS.dump`).
 * @param {Date} date */
export function backupFileName(date) {
  /** @param {number} n */
  const p = (n) => String(n).padStart(2, "0");
  return `pharmacore-${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}.dump`;
}
