import { describe, expect, it } from "vitest";

/**
 * Every feature dictionary (`src/i18n/*.keys.ts`) must export matching `<x>Ar` / `<x>En` maps with identical
 * key sets and non-empty values, and must not collide with the core dictionary or each other.
 */
const mods = import.meta.glob<Record<string, Record<string, string>>>("./*.keys.ts", { eager: true });
import { ar } from "./ar";
import { en } from "./en";

describe("feature i18n dictionaries", () => {
  it("exist (at least one agent-provided module)", () => { expect(Object.keys(mods).length).toBeGreaterThan(0); });
  for (const [file, m] of Object.entries(mods)) {
    const arKey = Object.keys(m).find((k) => k.endsWith("Ar")); const enKey = Object.keys(m).find((k) => k.endsWith("En"));
    it(`${file} has Ar/En with identical keys and no empty values`, () => {
      expect(arKey, "Ar export").toBeTruthy(); expect(enKey, "En export").toBeTruthy();
      const a = m[arKey ?? ""] ?? {}; const e = m[enKey ?? ""] ?? {};
      expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort());
      for (const d of [a, e]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe("");
    });
    it(`${file} does not override core keys`, () => {
      const a = m[arKey ?? ""] ?? {};
      for (const k of Object.keys(a)) { expect(ar[k], `core ar has ${k}`).toBeUndefined(); expect(en[k], `core en has ${k}`).toBeUndefined(); }
    });
  }
});
