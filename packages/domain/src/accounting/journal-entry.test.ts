import { RATE_SCALE } from "../fx/exchange-rate.js";
import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import { buildJournalEntry, reverseJournalEntry, type JournalEntryInput, type JournalLineInput } from "./journal-entry.js";

const BASE = "YER_NEW" as const;
const Y = (s: string): Money => unwrap(Money.parse(s, BASE));
const SAR = (s: string): Money => unwrap(Money.parse(s, "SAR"));
const at = new Date("2026-01-15T10:00:00Z");
const codeOf = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const input = (lines: readonly JournalLineInput[], extra: Partial<JournalEntryInput> = {}): JournalEntryInput => ({
  entryId: "je-1",
  tenantId: "t-1",
  documentRef: { type: "sales_invoice", id: "inv-1" },
  postedAt: at,
  currency: BASE,
  lines,
  ...extra,
});

/** Golden: sale 1,250.00 net, COGS 800.00, cash. */
const golden: JournalLineInput[] = [
  { accountCode: A.CASH_YER_NEW, debit: Y("1250.00"), dimensions: { cashboxId: "cb-1" } },
  { accountCode: A.SALES, credit: Y("1250.00") },
  { accountCode: A.COGS, debit: Y("800.00") },
  { accountCode: A.INVENTORY, credit: Y("800.00"), memo: "lot cost", dimensions: { itemId: "item-1", lotId: "lot-1" } },
];

describe("buildJournalEntry", () => {
  it("builds the golden cash sale: Dr Cash 1,250 / Cr Sales 1,250 ; Dr COGS 800 / Cr Inventory 800", () => {
    const e = unwrap(buildJournalEntry(input(golden)));
    expect(e.totalDebit.toDecimalString()).toBe("2050.00");
    expect(e.totalCredit.toDecimalString()).toBe("2050.00");
    expect(e.lines).toHaveLength(4);
    expect(e.lines[0]?.credit.isZero()).toBe(true);
    expect(e.lines[0]?.dimensions).toEqual({ cashboxId: "cb-1" });
    expect(e.lines[1]?.memo).toBeNull();
    expect(e.lines[1]?.dimensions).toEqual({});
    expect(e.lines[3]?.memo).toBe("lot cost");
    expect(e.lines[0]?.foreign).toBeNull();
    expect(e.memo).toBeNull();
    expect(e.reversesEntryId).toBeNull();
    expect(e.documentRef).toEqual({ type: "sales_invoice", id: "inv-1" });
    expect(e.postedAt).not.toBe(at);
    expect(e.postedAt.getTime()).toBe(at.getTime());
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.lines)).toBe(true);
    expect(Object.isFrozen(e.lines[0])).toBe(true);
    expect(Object.isFrozen(e.lines[0]?.dimensions)).toBe(true);
    expect(Object.isFrozen(e.documentRef)).toBe(true);
  });

  it("rejects an entry that is off by one minor unit", () => {
    const r = buildJournalEntry(input([{ accountCode: A.CASH_YER_NEW, debit: Y("1250.00") }, { accountCode: A.SALES, credit: Y("1249.99") }]));
    expect(codeOf(r)).toBe("accounting.unbalanced");
    if (!r.ok) expect(r.error.details).toEqual({ debit: "1250.00", credit: "1249.99", diff: "0.01" });
  });

  it("keeps memo, reversesEntryId and foreign snapshots", () => {
    const foreign = { amount: SAR("100.00"), rateScaledSnapshot: 430n * RATE_SCALE };
    const e = unwrap(
      buildJournalEntry(
        input(
          [
            { accountCode: A.CASH_SAR, debit: Y("43000.00"), foreign, dimensions: { cashboxId: "cb-1" } },
            { accountCode: A.SALES, credit: Y("43000.00"), foreign: null },
          ],
          { memo: "PR-15", reversesEntryId: "je-0" },
        ),
      ),
    );
    expect(e.memo).toBe("PR-15");
    expect(e.reversesEntryId).toBe("je-0");
    expect(e.lines[0]?.foreign).toEqual(foreign);
    expect(e.lines[0]?.foreign).not.toBe(foreign);
    expect(Object.isFrozen(e.lines[0]?.foreign)).toBe(true);
    expect(e.lines[1]?.foreign).toBeNull();
  });

  const cases: ReadonlyArray<readonly [string, JournalEntryInput, string]> = [
    ["too few lines", input([golden[0] as JournalLineInput]), "accounting.too_few_lines"],
    ["empty entryId", input(golden, { entryId: "" }), "accounting.invalid_id"],
    ["blank tenantId", input(golden, { tenantId: "  " }), "accounting.invalid_id"],
    ["document type missing", input(golden, { documentRef: { type: "", id: "x" } }), "accounting.invalid_document_ref"],
    ["document id missing", input(golden, { documentRef: { type: "x", id: " " } }), "accounting.invalid_document_ref"],
    ["invalid postedAt", input(golden, { postedAt: new Date("not a date") }), "accounting.invalid_posted_at"],
    ["unknown account", input([{ accountCode: "9999", debit: Y("1.00") }, { accountCode: A.SALES, credit: Y("1.00") }]), "accounting.unknown_account"],
    ["header account", input([{ accountCode: A.ASSETS, debit: Y("1.00") }, { accountCode: A.SALES, credit: Y("1.00") }]), "accounting.account_not_postable"],
    ["debit in another currency", input([{ accountCode: A.CASH_SAR, debit: SAR("1.00") }, { accountCode: A.SALES, credit: Y("1.00") }]), "accounting.currency_mismatch"],
    ["credit in another currency", input([{ accountCode: A.CASH_SAR, debit: Y("1.00") }, { accountCode: A.SALES, credit: SAR("1.00") }]), "accounting.currency_mismatch"],
    ["negative amount", input([{ accountCode: A.CASH_YER_NEW, debit: Y("-1.00") }, { accountCode: A.SALES, credit: Y("-1.00") }]), "accounting.negative_amount"],
    ["two-sided line", input([{ accountCode: A.CASH_YER_NEW, debit: Y("1.00"), credit: Y("1.00") }, { accountCode: A.SALES, credit: Y("0.00") }]), "accounting.line_two_sided"],
    ["empty line", input([{ accountCode: A.CASH_YER_NEW }, { accountCode: A.SALES, credit: Y("1.00") }]), "accounting.line_zero"],
    ["zero line", input([{ accountCode: A.CASH_YER_NEW, debit: Y("0.00"), credit: Y("0.00") }, { accountCode: A.SALES, credit: Y("1.00") }]), "accounting.line_zero"],
    [
      "non-positive rate snapshot",
      input([
        { accountCode: A.CASH_SAR, debit: Y("1.00"), foreign: { amount: SAR("1.00"), rateScaledSnapshot: 0n } },
        { accountCode: A.SALES, credit: Y("1.00") },
      ]),
      "accounting.invalid_rate",
    ],
  ];
  for (const [name, inp, code] of cases) {
    it(`rejects ${name} with ${code}`, () => {
      expect(codeOf(buildJournalEntry(inp))).toBe(code);
    });
  }

  it("reports the failing line index on account errors", () => {
    const r = buildJournalEntry(input([{ accountCode: A.CASH_YER_NEW, debit: Y("1.00") }, { accountCode: "9999", credit: Y("1.00") }]));
    if (!r.ok) expect(r.error.details).toMatchObject({ line: 1, accountCode: "9999" });
    expect(r.ok).toBe(false);
  });
});

describe("reverseJournalEntry", () => {
  const original = unwrap(buildJournalEntry(input(golden, { memo: "orig" })));

  it("mirrors every line and links the original (PR-17)", () => {
    const r = unwrap(reverseJournalEntry(original, { entryId: "je-2", reason: "wrong lot", at }));
    expect(r.entryId).toBe("je-2");
    expect(r.tenantId).toBe("t-1");
    expect(r.reversesEntryId).toBe("je-1");
    expect(r.memo).toBe("wrong lot");
    expect(r.documentRef).toEqual(original.documentRef);
    expect(r.lines[0]?.credit.equals(Y("1250.00"))).toBe(true);
    expect(r.lines[0]?.debit.isZero()).toBe(true);
    expect(r.lines[0]?.memo).toBeNull();
    expect(r.lines[0]?.dimensions).toEqual({ cashboxId: "cb-1" });
    expect(r.lines[3]?.debit.equals(Y("800.00"))).toBe(true);
    expect(r.lines[3]?.memo).toBe("lot cost");
    expect(r.totalDebit.equals(original.totalCredit)).toBe(true);
    expect(r.totalCredit.equals(original.totalDebit)).toBe(true);
  });

  it("keeps foreign snapshots on reversed lines", () => {
    const foreign = { amount: SAR("100.00"), rateScaledSnapshot: 430n * RATE_SCALE };
    const e = unwrap(buildJournalEntry(input([{ accountCode: A.CASH_SAR, debit: Y("43000.00"), foreign }, { accountCode: A.SALES, credit: Y("43000.00") }])));
    const r = unwrap(reverseJournalEntry(e, { entryId: "je-3", reason: "void", at: new Date(at.getTime() + 1000) }));
    expect(r.lines[0]?.foreign).toEqual(foreign);
    expect(r.lines[0]?.credit.equals(Y("43000.00"))).toBe(true);
  });

  it("rejects an empty reason", () => {
    expect(codeOf(reverseJournalEntry(original, { entryId: "je-2", reason: " ", at }))).toBe("accounting.reversal_reason_required");
  });

  it("rejects a reversal dated before the original or with an invalid date", () => {
    expect(codeOf(reverseJournalEntry(original, { entryId: "je-2", reason: "x", at: new Date(at.getTime() - 1) }))).toBe("accounting.reversal_before_original");
    expect(codeOf(reverseJournalEntry(original, { entryId: "je-2", reason: "x", at: new Date("bad") }))).toBe("accounting.reversal_before_original");
  });
});
