/**
 * Barcode normalisation (FR-BAR): GS1 GTIN-8/12/13/14 are zero-padded to GTIN-14 after check-digit
 * verification; GS1 DataMatrix / GS1-128 element strings are parsed for AI 01 (GTIN), 10 (lot),
 * 17 (expiry YYMMDD, DD=00 → end of month), 21 (serial). Internal codes are kept verbatim.
 */
export type BarcodeType = "EAN13" | "EAN8" | "UPCA" | "GTIN14" | "CODE128" | "INTERNAL" | "GS1_DATAMATRIX";

export interface ParsedBarcode {
  readonly raw: string;
  readonly type: BarcodeType;
  readonly normalized: string; // GTIN-14 for GS1 types, raw for others
  readonly gtin?: string;
  readonly lot?: string;
  readonly expiry?: string; // ISO date
  readonly serial?: string;
}

const FNC1 = "\u001d";

export function gs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  const len = digitsWithoutCheck.length;
  for (let i = 0; i < len; i++) {
    const d = Number(digitsWithoutCheck.charAt(len - 1 - i));
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  return gs1CheckDigit(digits.slice(0, -1)) === Number(digits.at(-1));
}

export function toGtin14(digits: string): string {
  return digits.padStart(14, "0");
}

function gs1Expiry(yymmdd: string): string | undefined {
  if (!/^\d{6}$/.test(yymmdd)) return undefined;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  let dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  // GS1 century rule: 51-99 → 19xx/20xx window relative to current year; pharmacy stock is always near-future
  const nowYY = new Date().getUTCFullYear() % 100;
  const century = yy - nowYY > 50 ? 1900 : yy - nowYY < -50 ? 2100 : 2000;
  const year = century + yy;
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0 || dd > lastDay) dd = lastDay; // DD=00 → end of month
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Parses a GS1 element string (with or without FNC1 separators / leading "]d2"). */
export function parseGs1(raw: string): Omit<ParsedBarcode, "type" | "normalized"> | null {
  let s = raw.replace(/^\]d2|^\]C1|^\]Q3/, "");
  if (s.startsWith("(")) s = s.replace(/[()]/g, ""); // human-readable form "(01)...(17)..."
  const out: { gtin?: string; lot?: string; expiry?: string; serial?: string } = {};
  let i = 0;
  const fixed: Record<string, number> = { "01": 14, "17": 6, "11": 6, "15": 6, "30": 0 };
  while (i < s.length) {
    if (s[i] === FNC1) { i++; continue; }
    const ai = s.slice(i, i + 2);
    i += 2;
    if (ai === "01" || ai === "17" || ai === "11" || ai === "15") {
      const n = fixed[ai]!;
      const v = s.slice(i, i + n);
      i += n;
      if (ai === "01") { if (!isValidGtin(v)) return null; out.gtin = v; }
      else if (ai === "17") { const e = gs1Expiry(v); if (!e) return null; out.expiry = e; }
    } else if (ai === "10" || ai === "21") {
      const end = s.indexOf(FNC1, i);
      const v = end === -1 ? s.slice(i) : s.slice(i, end);
      i = end === -1 ? s.length : end + 1;
      if (ai === "10") out.lot = v; else out.serial = v;
    } else {
      return null; // unknown AI — treat as not GS1
    }
  }
  if (!out.gtin) return null;
  return { raw, ...out };
}

export function parseBarcode(input: string): ParsedBarcode {
  const raw = input.trim();
  const digits = raw.replace(/\s+/g, "");
  if (/^\d+$/.test(digits)) {
    if (digits.length === 8 && isValidGtin(digits)) return { raw, type: "EAN8", normalized: toGtin14(digits), gtin: toGtin14(digits) };
    if (digits.length === 12 && isValidGtin(digits)) return { raw, type: "UPCA", normalized: toGtin14(digits), gtin: toGtin14(digits) };
    if (digits.length === 13 && isValidGtin(digits)) return { raw, type: "EAN13", normalized: toGtin14(digits), gtin: toGtin14(digits) };
    if (digits.length === 14 && isValidGtin(digits)) return { raw, type: "GTIN14", normalized: digits, gtin: digits };
  }
  if (raw.length >= 16 && (raw.includes(FNC1) || raw.startsWith("]d2") || raw.startsWith("(01)") || /^01\d{14}/.test(raw))) {
    const gs1 = parseGs1(raw);
    if (gs1) {
      const g = toGtin14(gs1.gtin!);
      return { raw, type: "GS1_DATAMATRIX", normalized: g, gtin: g, ...(gs1.lot ? { lot: gs1.lot } : {}), ...(gs1.expiry ? { expiry: gs1.expiry } : {}), ...(gs1.serial ? { serial: gs1.serial } : {}) };
    }
  }
  if (/^PC[0-9A-Z]{6,}$/i.test(raw)) return { raw, type: "INTERNAL", normalized: raw.toUpperCase() };
  return { raw, type: "CODE128", normalized: raw };
}

/** Internal barcode for items without a manufacturer code: prefix 2 (GS1 restricted circulation) + 10 digits + check → EAN-13 compatible. */
export function internalEan13(sequence: number): string {
  const body = `2${String(sequence).padStart(11, "0")}`.slice(0, 12);
  return body + String(gs1CheckDigit(body));
}
