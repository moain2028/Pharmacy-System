/**
 * Minimal, dependency-free SQL migration runner.
 *
 * Migrations are plain SQL files in ./migrations named `NNNN_name.sql`, applied in
 * lexical order inside a single transaction each and recorded in `schema_migrations`
 * together with a sha256 of the file. A changed file that was already applied is a hard
 * error (migrations are immutable once shipped — write a new one).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export type Sql = postgres.Sql;

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: Date;
}

export const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export async function loadMigrationFiles(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const m = FILE_RE.exec(entry);
    if (!m) continue;
    const path = join(dir, entry);
    const sql = await readFile(path, "utf8");
    files.push({
      version: m[1] as string,
      name: m[2] as string,
      path,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  files.sort((a, b) => a.version.localeCompare(b.version));
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.version)) throw new Error(`duplicate migration version ${f.version}`);
    seen.add(f.version);
  }
  return files;
}

async function ensureTable(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
}

export async function appliedMigrations(sql: Sql): Promise<AppliedMigration[]> {
  await ensureTable(sql);
  return sql<AppliedMigration[]>`SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version`;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export async function migrate(sql: Sql, dir: string = DEFAULT_MIGRATIONS_DIR): Promise<MigrateResult> {
  const files = await loadMigrationFiles(dir);
  const done = new Map((await appliedMigrations(sql)).map((m) => [m.version, m]));
  const applied: string[] = [];
  const skipped: string[] = [];
  // serialize concurrent runners (e.g. two API instances booting at once)
  await sql`SELECT pg_advisory_lock(727172)`;
  try {
    for (const f of files) {
      const prev = done.get(f.version);
      if (prev) {
        if (prev.checksum !== f.checksum) {
          throw new Error(
            `migration ${f.version}_${f.name} was modified after being applied (checksum mismatch). Migrations are immutable; add a new one.`,
          );
        }
        skipped.push(f.version);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(f.sql);
        await tx`INSERT INTO schema_migrations (version, name, checksum) VALUES (${f.version}, ${f.name}, ${f.checksum})`;
      });
      applied.push(f.version);
    }
  } finally {
    await sql`SELECT pg_advisory_unlock(727172)`;
  }
  return { applied, skipped };
}

/** Drops and recreates the `public` schema. TEST/DEV ONLY — refuses unless explicitly allowed. */
export async function resetDatabase(sql: Sql, opts: { readonly allowDestructive: boolean }): Promise<void> {
  if (!opts.allowDestructive) throw new Error("resetDatabase refused: pass allowDestructive=true (never in production)");
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

/**
 * Opens a pool. `date` columns (OID 1082) are returned as plain "YYYY-MM-DD" strings instead of
 * JS Dates: business dates (expiry, business_date) must never shift with the server timezone.
 */
export function connect(url: string, max = 4): Sql {
  return postgres(url, {
    max,
    onnotice: () => undefined,
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
}
