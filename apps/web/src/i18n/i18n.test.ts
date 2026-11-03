import { describe, expect, it } from "vitest";
import { ar } from "./ar";
import { en } from "./en";
import { translate } from "./index";

describe("i18n dictionaries", () => {
  it("ar and en define exactly the same keys", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it("no empty values", () => {
    for (const d of [ar, en]) for (const [k, v] of Object.entries(d)) expect(v.trim(), k).not.toBe("");
  });
  it("interpolates variables and falls back to key", () => {
    expect(translate("en", "nope.key")).toBe("nope.key");
    expect(translate("ar", "common.save")).toBe("حفظ");
  });
});
