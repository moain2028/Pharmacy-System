import { describe, expect, it } from "vitest";
import { backupFileName, parseEnv, pgEnvFromUrl, sidecarTriple } from "./env.mjs";

describe("desktop packaging helpers", () => {
  it("parses .env with comments and = in values", () => {
    expect(parseEnv("# c\nA=1\nDATABASE_URL=postgres://u:p=x@h:5433/db\n\nBAD\n")).toEqual({ A: "1", DATABASE_URL: "postgres://u:p=x@h:5433/db" });
  });
  it("maps a postgres URL to libpq variables", () => {
    expect(pgEnvFromUrl("postgres://pharmacore:s%40cret@127.0.0.1:5433/pharmacore")).toEqual({ PGHOST: "127.0.0.1", PGPORT: "5433", PGUSER: "pharmacore", PGPASSWORD: "s@cret", PGDATABASE: "pharmacore" });
    expect(pgEnvFromUrl("postgres://u:p@h/db").PGPORT).toBe("5432");
  });
  it("produces Tauri sidecar triples", () => {
    expect(sidecarTriple("win32")).toBe("x86_64-pc-windows-msvc");
    expect(sidecarTriple("darwin", "arm64")).toBe("aarch64-apple-darwin");
    expect(sidecarTriple("linux")).toBe("x86_64-unknown-linux-gnu");
  });
  it("backup file names match the API regex", () => {
    const n = backupFileName(new Date(Date.UTC(2026, 2, 1, 3, 4, 5)));
    expect(n).toBe("pharmacore-20260301-030405.dump");
    expect(/^pharmacore-\d{8}-\d{6}\.dump$/.test(n)).toBe(true);
  });
});
