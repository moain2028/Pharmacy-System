import { Inject, Injectable, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONFIG, type AppConfig } from "../infra/config.js";
import { ApiError } from "../shared/errors.js";

export interface BackupMeta { fileName: string; sizeBytes: number; createdAt: string; sha256: string; note: string | null }

/**
 * Backups = `pg_dump --format=custom` of the whole database (single-tenant desktop deployment) written to
 * BACKUP_DIR with a sidecar `.meta.json` (sha256 + note). Restore is a two-step: upload → verify checksum →
 * `pg_restore --clean --if-exists` inside a maintenance window (only the owner may call it).
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger("Backup");
  private readonly dir: string;
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.dir = resolve(cfg.BACKUP_DIR);
  }

  private run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((res, rej) => {
      const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
      p.on("error", rej);
      p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err.slice(0, 500)}`))));
    });
  }
  private pgEnv(): NodeJS.ProcessEnv {
    const u = new URL(this.cfg.DATABASE_URL);
    return { PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) };
  }
  private async sha256(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex"); }
  private safeName(name: string): string {
    if (!/^pharmacore-\d{8}-\d{6}\.dump$/.test(name)) throw ApiError.badRequest("backup.invalid_name", "Invalid backup file name");
    return name;
  }

  async create(note?: string | undefined): Promise<BackupMeta> {
    await mkdir(this.dir, { recursive: true });
    // Name = second-resolution timestamp (contract shared with desktop scripts). If two backups land in the
    // same second, advance to the next free second instead of overwriting the previous file.
    const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/(\d{8})(\d{6}).*/, "$1-$2");
    let at = Date.now(); let fileName = `pharmacore-${stamp(new Date(at))}.dump`; let path = join(this.dir, fileName);
    while (await stat(path).then(() => true, () => false)) { at += 1000; fileName = `pharmacore-${stamp(new Date(at))}.dump`; path = join(this.dir, fileName); }
    await this.run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", path], this.pgEnv());
    const [s, sha] = await Promise.all([stat(path), this.sha256(path)]);
    const meta: BackupMeta = { fileName, sizeBytes: s.size, createdAt: new Date().toISOString(), sha256: sha, note: note ?? null };
    await writeFile(`${path}.meta.json`, JSON.stringify(meta));
    this.log.log(`backup created ${fileName} (${s.size} bytes)`);
    await this.prune();
    return meta;
  }

  async list(): Promise<BackupMeta[]> {
    await mkdir(this.dir, { recursive: true });
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".meta.json"));
    const metas = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(this.dir, f), "utf8")) as BackupMeta));
    return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async filePath(name: string): Promise<string> {
    const path = join(this.dir, this.safeName(name));
    try { await stat(path); } catch { throw ApiError.notFound("backup.not_found", "Backup not found"); }
    return path;
  }

  async verify(name: string): Promise<{ ok: boolean; expected: string; actual: string }> {
    const path = await this.filePath(name);
    const meta = JSON.parse(await readFile(`${path}.meta.json`, "utf8")) as BackupMeta;
    const actual = await this.sha256(path);
    return { ok: actual === meta.sha256, expected: meta.sha256, actual };
  }

  /** Destructive: restores the named backup over the current database. Caller must have verified checksum + confirmed. */
  async restore(name: string): Promise<{ restored: string }> {
    const v = await this.verify(name);
    if (!v.ok) throw ApiError.conflict("backup.checksum_mismatch", "Backup file is corrupted", { ...v });
    const path = await this.filePath(name);
    await this.run("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", this.pgEnv()["PGDATABASE"] ?? "", path], this.pgEnv());
    this.log.warn(`database restored from ${name}`);
    return { restored: name };
  }

  /** Keep the newest BACKUP_KEEP files (default 30). */
  private async prune(): Promise<void> {
    const all = await this.list();
    for (const m of all.slice(this.cfg.BACKUP_KEEP)) {
      await unlink(join(this.dir, m.fileName)).catch(() => undefined);
      await unlink(join(this.dir, `${m.fileName}.meta.json`)).catch(() => undefined);
    }
  }
}
