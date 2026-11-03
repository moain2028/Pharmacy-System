import { describe, expect, it } from "vitest";
import type { Result } from "../shared/result.js";
import {
  ACCOUNT_CODES as A,
  CASH_ACCOUNT_BY_CURRENCY,
  DEFAULT_CHART,
  NORMAL_BALANCE_BY_TYPE,
  accountsByType,
  cashAccountFor,
  childrenOf,
  findAccount,
  getAccount,
  getPostableAccount,
  isCashAccount,
  oppositeSide,
  validateChart,
  type Account,
} from "./chart-of-accounts.js";

const codeOf = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const mk = (over: Partial<Account> = {}): Account => ({
  code: "9000",
  nameAr: "x",
  nameEn: "x",
  type: "ASSET",
  normalBalance: "DEBIT",
  isPostable: true,
  parentCode: null,
  isContra: false,
  ...over,
});
const hdr = (code: string, parentCode: string | null = null): Account => mk({ code, parentCode, isPostable: false });

describe("DEFAULT_CHART", () => {
  it("is structurally valid and frozen", () => {
    expect(codeOf(validateChart(DEFAULT_CHART))).toBe("ok");
    expect(Object.isFrozen(DEFAULT_CHART)).toBe(true);
    for (const a of DEFAULT_CHART) expect(Object.isFrozen(a)).toBe(true);
  });

  it("contains every canonical code exactly once", () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of Object.values(A)) expect(codes).toContain(code);
    expect(DEFAULT_CHART).toHaveLength(Object.keys(A).length);
  });

  it("derives the normal balance from the type and flips it for contra accounts", () => {
    expect(NORMAL_BALANCE_BY_TYPE).toEqual({ ASSET: "DEBIT", LIABILITY: "CREDIT", EQUITY: "CREDIT", REVENUE: "CREDIT", EXPENSE: "DEBIT" });
    expect(findAccount(A.SALES)?.normalBalance).toBe("CREDIT");
    expect(findAccount(A.SALES_RETURNS)?.normalBalance).toBe("DEBIT");
    expect(findAccount(A.DISCOUNTS_ALLOWED)?.isContra).toBe(true);
    expect(findAccount(A.OWNER_DRAWINGS)?.normalBalance).toBe("DEBIT");
    expect(findAccount(A.ACCOUNTS_PAYABLE)?.normalBalance).toBe("CREDIT");
    expect(findAccount(A.COGS)?.normalBalance).toBe("DEBIT");
    expect(findAccount(A.COGS)?.isContra).toBe(false);
    expect(oppositeSide("DEBIT")).toBe("CREDIT");
    expect(oppositeSide("CREDIT")).toBe("DEBIT");
  });

  it("marks headers as non-postable and nests operating expenses under 5500", () => {
    expect(findAccount(A.ASSETS)?.isPostable).toBe(false);
    expect(findAccount(A.OPERATING_EXPENSES)?.isPostable).toBe(false);
    expect(findAccount(A.INVENTORY)?.isPostable).toBe(true);
    expect(findAccount(A.ELECTRICITY)?.parentCode).toBe(A.OPERATING_EXPENSES);
    expect(findAccount(A.OPERATING_EXPENSES)?.parentCode).toBe(A.EXPENSES);
    expect(findAccount(A.ASSETS)?.parentCode).toBeNull();
  });
});

describe("lookups", () => {
  it("getAccount / findAccount", () => {
    expect(findAccount("9999")).toBeUndefined();
    expect(codeOf(getAccount("9999"))).toBe("accounting.unknown_account");
    const r = getAccount(A.INVENTORY);
    expect(r.ok && r.value.nameEn).toBe("Inventory");
  });

  it("getPostableAccount rejects headers and unknown codes", () => {
    expect(codeOf(getPostableAccount(A.ASSETS))).toBe("accounting.account_not_postable");
    expect(codeOf(getPostableAccount("0000"))).toBe("accounting.unknown_account");
    expect(codeOf(getPostableAccount(A.CASH_YER_NEW))).toBe("ok");
  });

  it("accountsByType optionally filters headers", () => {
    const all = accountsByType("EXPENSE");
    expect(all.map((a) => a.code)).toContain(A.EXPENSES);
    expect(all.map((a) => a.code)).toContain(A.OPERATING_EXPENSES);
    const postable = accountsByType("EXPENSE", { postableOnly: true });
    expect(postable.every((a) => a.isPostable)).toBe(true);
    expect(postable.length).toBe(all.length - 2);
    expect(accountsByType("EQUITY").map((a) => a.code)).toEqual([A.EQUITY, A.CAPITAL, A.OWNER_DRAWINGS, A.RETAINED_EARNINGS]);
  });

  it("childrenOf lists direct children only", () => {
    expect(childrenOf(A.ASSETS).map((a) => a.code)).toEqual([
      A.CASH_YER_NEW, A.CASH_YER_OLD, A.CASH_SAR, A.CASH_USD, A.BANK, A.WALLET, A.ACCOUNTS_RECEIVABLE, A.INVENTORY, A.INPUT_VAT,
    ]);
    expect(childrenOf(A.EXPENSES).map((a) => a.code)).not.toContain(A.ELECTRICITY);
    expect(childrenOf("9999")).toEqual([]);
  });

  it("maps every currency to its own cash account", () => {
    expect(cashAccountFor("YER_NEW")).toBe(A.CASH_YER_NEW);
    expect(cashAccountFor("YER_OLD")).toBe(A.CASH_YER_OLD);
    expect(cashAccountFor("SAR")).toBe(A.CASH_SAR);
    expect(cashAccountFor("USD")).toBe(A.CASH_USD);
    expect(Object.keys(CASH_ACCOUNT_BY_CURRENCY)).toHaveLength(4);
    expect(isCashAccount(A.CASH_SAR)).toBe(true);
    expect(isCashAccount(A.BANK)).toBe(false);
  });
});

describe("validateChart", () => {
  it("rejects duplicate codes", () => {
    expect(codeOf(validateChart([mk(), mk()]))).toBe("accounting.chart_duplicate_code");
  });
  it("rejects a missing parent", () => {
    expect(codeOf(validateChart([mk({ parentCode: "1000" })]))).toBe("accounting.chart_missing_parent");
  });
  it("rejects a postable parent", () => {
    expect(codeOf(validateChart([mk({ code: "1000" }), mk({ code: "1001", parentCode: "1000" })]))).toBe("accounting.chart_parent_not_header");
  });
  it("rejects a type mismatch with the parent", () => {
    const r = validateChart([hdr("1000"), mk({ code: "1001", parentCode: "1000", type: "REVENUE", normalBalance: "CREDIT" })]);
    expect(codeOf(r)).toBe("accounting.chart_type_mismatch");
  });
  it("rejects cycles between headers", () => {
    expect(codeOf(validateChart([hdr("1000", "1001"), hdr("1001", "1000")]))).toBe("accounting.chart_cycle");
  });
  it("walks a chain whose ancestor is missing and reports the missing parent", () => {
    expect(codeOf(validateChart([mk({ code: "1001", parentCode: "1000" }), hdr("1000", "0999")]))).toBe("accounting.chart_missing_parent");
  });
  it("accepts a small valid chart with a root leaf", () => {
    expect(codeOf(validateChart([hdr("1000"), mk({ code: "1001", parentCode: "1000" }), mk({ code: "7000" })]))).toBe("ok");
  });
});
