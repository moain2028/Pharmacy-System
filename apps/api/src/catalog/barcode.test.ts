import { describe, expect, it } from "vitest";
import { gs1CheckDigit, internalEan13, isValidGtin, parseBarcode, parseGs1 } from "./barcode.js";

describe("GS1 check digit", () => {
  it("computes and validates", () => {
    expect(gs1CheckDigit("629104150021")).toBe(3); // 6291041500213 (Saudi EAN-13)
    expect(isValidGtin("6291041500213")).toBe(true);
    expect(isValidGtin("6291041500214")).toBe(false);
    expect(isValidGtin("12345670")).toBe(true); // EAN-8
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("1234")).toBe(false);
  });
});

describe("parseBarcode", () => {
  it("normalises EAN-13/EAN-8/UPC-A to GTIN-14", () => {
    expect(parseBarcode("6291041500213")).toMatchObject({ type: "EAN13", normalized: "06291041500213" });
    expect(parseBarcode("12345670")).toMatchObject({ type: "EAN8", normalized: "00000012345670" });
    expect(parseBarcode("036000291452")).toMatchObject({ type: "UPCA", normalized: "00036000291452" });
    expect(parseBarcode("06291041500213")).toMatchObject({ type: "GTIN14", normalized: "06291041500213" });
  });
  it("parses GS1 DataMatrix element strings with lot/expiry/serial, DD=00 → end of month", () => {
    const fnc1 = "\u001d";
    const p = parseBarcode(`]d20106291041500213172802001012AB34${fnc1}21SER9`);
    expect(p.type).toBe("GS1_DATAMATRIX");
    expect(p.normalized).toBe("06291041500213");
    expect(p.expiry).toBe("2028-02-29");
    expect(p.lot).toBe("12AB34");
    expect(p.serial).toBe("SER9");
    const h = parseBarcode("(01)06291041500213(17)271231(10)L7");
    expect(h).toMatchObject({ type: "GS1_DATAMATRIX", expiry: "2027-12-31", lot: "L7" });
  });
  it("rejects GS1 with bad GTIN check digit or unknown AI → falls back to CODE128", () => {
    expect(parseGs1("0106291041500214")).toBeNull();
    expect(parseGs1("0106291041500213991234")).toBeNull();
    expect(parseGs1("1012345")).toBeNull();
    expect(parseGs1("0106291041500213171313")).toBeNull();
    expect(parseBarcode("0106291041500214171313")).toMatchObject({ type: "CODE128" });
  });
  it("keeps internal/other codes verbatim", () => {
    expect(parseBarcode("pc000123")).toMatchObject({ type: "INTERNAL", normalized: "PC000123" });
    expect(parseBarcode("ABC-77")).toMatchObject({ type: "CODE128", normalized: "ABC-77" });
    expect(parseBarcode("6291041500214")).toMatchObject({ type: "CODE128" }); // bad check digit → not GS1
  });
  it("internal EAN-13 uses prefix 2 and a valid check digit", () => {
    const b = internalEan13(42);
    expect(b).toHaveLength(13);
    expect(b.startsWith("2")).toBe(true);
    expect(isValidGtin(b)).toBe(true);
  });
});
