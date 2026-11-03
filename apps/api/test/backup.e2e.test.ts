import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootTestApp, type TestCtx } from "./helpers.js";

let c: TestCtx; let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pc-backup-"));
  process.env["BACKUP_DIR"] = dir; process.env["BACKUP_KEEP"] = "2";
  c = await bootTestApp();
});
afterAll(async () => { await c.app.close(); rmSync(dir, { recursive: true, force: true }); delete process.env["BACKUP_DIR"]; delete process.env["BACKUP_KEEP"]; });

describe("backup", () => {
  it("creates a pg_dump, lists it, verifies checksum, downloads it", async () => {
    const r = await c.call("POST", "/backup", { note: "before stocktake" });
    expect(r.status).toBe(201);
    expect(r.body.fileName).toMatch(/^pharmacore-\d{8}-\d{6}\.dump$/);
    expect(r.body.sizeBytes).toBeGreaterThan(1000);
    expect(r.body.sha256).toHaveLength(64);
    const l = await c.call("GET", "/backup");
    expect(l.body[0].fileName).toBe(r.body.fileName);
    const v = await c.call("GET", `/backup/${r.body.fileName}/verify`);
    expect(v.body.ok).toBe(true);
    const d = await c.app.inject({ method: "GET", url: `/api/v1/backup/${r.body.fileName}/download`, headers: { authorization: `Bearer ${c.access}` } });
    expect(d.statusCode).toBe(200);
    expect(d.headers["content-disposition"]).toContain(r.body.fileName);
    expect(d.rawPayload.length).toBe(r.body.sizeBytes);
  });
  it("rejects bad names and requires explicit confirmation to restore", async () => {
    expect((await c.call("GET", "/backup/../etc/passwd/verify")).status).toBeGreaterThanOrEqual(400);
    expect((await c.call("GET", "/backup/pharmacore-99999999-999999.dump/verify")).status).toBe(404);
    const l = await c.call("GET", "/backup");
    const bad = await c.call("POST", `/backup/${l.body[0].fileName}/restore`, { confirm: "yes" });
    expect(bad.status).toBe(400);
  });
  it("prunes to BACKUP_KEEP", async () => {
    await c.call("POST", "/backup"); await c.call("POST", "/backup");
    const l = await c.call("GET", "/backup");
    expect(l.body.length).toBe(2);
  });
});
