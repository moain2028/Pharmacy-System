/**
 * Default pharmacy chart of accounts — ACCOUNTING-DESIGN §2 (Anglo-Saxon, base-currency ledger).
 *
 * Seed data only: no I/O. Codes are stable identifiers used by posting rules, reports and the API.
 * Header accounts (x000 and 5500) group postable leaves and are never posted to.
 * Cash is one GL account per currency (1100/1110/1200/1210); the cashbox itself is a line
 * dimension, so "cash per cashbox/currency" = (account, dimensions.cashboxId).
 */
import type { CurrencyCode } from "../money/currency.js";
import { domainErr, ok, type Result } from "../shared/result.js";

export type NormalBalance = "DEBIT" | "CREDIT";
export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface Account {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly type: AccountType;
  /** Side that increases the account. Contra accounts carry the opposite side of their type. */
  readonly normalBalance: NormalBalance;
  readonly isPostable: boolean;
  readonly parentCode: string | null;
  readonly isContra: boolean;
}

export const NORMAL_BALANCE_BY_TYPE: Readonly<Record<AccountType, NormalBalance>> = Object.freeze({
  ASSET: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
  EXPENSE: "DEBIT",
});

export function oppositeSide(side: NormalBalance): NormalBalance {
  return side === "DEBIT" ? "CREDIT" : "DEBIT";
}

interface AccountOpts {
  readonly header?: boolean;
  readonly contra?: boolean;
}

function acct(
  code: string,
  nameAr: string,
  nameEn: string,
  type: AccountType,
  parentCode: string | null,
  opts: AccountOpts = {},
): Account {
  const contra = opts.contra === true;
  const base = NORMAL_BALANCE_BY_TYPE[type];
  return Object.freeze({
    code,
    nameAr,
    nameEn,
    type,
    normalBalance: contra ? oppositeSide(base) : base,
    isPostable: opts.header !== true,
    parentCode,
    isContra: contra,
  });
}

/** Canonical codes referenced by posting rules (ACCOUNTING-DESIGN PR-01 … PR-17). */
export const ACCOUNT_CODES = Object.freeze({
  ASSETS: "1000",
  CASH_YER_NEW: "1100",
  CASH_YER_OLD: "1110",
  CASH_SAR: "1200",
  CASH_USD: "1210",
  BANK: "1250",
  WALLET: "1260",
  ACCOUNTS_RECEIVABLE: "1300",
  INVENTORY: "1400",
  INPUT_VAT: "1500",
  LIABILITIES: "2000",
  ACCOUNTS_PAYABLE: "2100",
  GRNI: "2150",
  OUTPUT_VAT: "2200",
  CUSTOMER_DEPOSITS: "2300",
  EQUITY: "3000",
  CAPITAL: "3100",
  OWNER_DRAWINGS: "3200",
  RETAINED_EARNINGS: "3300",
  REVENUE: "4000",
  SALES: "4100",
  SALES_RETURNS: "4110",
  DISCOUNTS_ALLOWED: "4120",
  FX_GAIN: "4200",
  OTHER_INCOME: "4300",
  EXPENSES: "5000",
  COGS: "5100",
  PURCHASE_PRICE_VARIANCE: "5150",
  PURCHASE_RETURN_LOSS: "5250",
  EXPIRY_WRITE_OFF: "5200",
  INVENTORY_SHRINKAGE: "5300",
  FX_LOSS: "5400",
  OPERATING_EXPENSES: "5500",
  ELECTRICITY: "5510",
  RENT: "5520",
  OTHER_EXPENSES: "5530",
  SALARIES: "5540",
  BANK_FEES: "5550",
  MAINTENANCE: "5560",
} as const);

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

const C = ACCOUNT_CODES;

export const DEFAULT_CHART: readonly Account[] = Object.freeze([
  acct(C.ASSETS, "الأصول", "Assets", "ASSET", null, { header: true }),
  acct(C.CASH_YER_NEW, "الصندوق — ريال جديد", "Cash — YER (new)", "ASSET", C.ASSETS),
  acct(C.CASH_YER_OLD, "الصندوق — ريال قديم", "Cash — YER (old)", "ASSET", C.ASSETS),
  acct(C.CASH_SAR, "الصندوق — ريال سعودي", "Cash — SAR", "ASSET", C.ASSETS),
  acct(C.CASH_USD, "الصندوق — دولار", "Cash — USD", "ASSET", C.ASSETS),
  acct(C.BANK, "البنك", "Bank", "ASSET", C.ASSETS),
  acct(C.WALLET, "المحافظ الإلكترونية", "E-wallets", "ASSET", C.ASSETS),
  acct(C.ACCOUNTS_RECEIVABLE, "ذمم العملاء", "Accounts receivable", "ASSET", C.ASSETS),
  acct(C.INVENTORY, "المخزون", "Inventory", "ASSET", C.ASSETS),
  acct(C.INPUT_VAT, "ضريبة المدخلات", "Input VAT", "ASSET", C.ASSETS),
  acct(C.LIABILITIES, "الالتزامات", "Liabilities", "LIABILITY", null, { header: true }),
  acct(C.ACCOUNTS_PAYABLE, "ذمم الموردين", "Accounts payable", "LIABILITY", C.LIABILITIES),
  acct(C.GRNI, "بضاعة مستلمة غير مفوترة", "Goods received not invoiced", "LIABILITY", C.LIABILITIES),
  acct(C.OUTPUT_VAT, "ضريبة المخرجات", "Output VAT", "LIABILITY", C.LIABILITIES),
  acct(C.CUSTOMER_DEPOSITS, "دفعات مقدمة من العملاء", "Customer deposits", "LIABILITY", C.LIABILITIES),
  acct(C.EQUITY, "حقوق الملكية", "Equity", "EQUITY", null, { header: true }),
  acct(C.CAPITAL, "رأس المال / رصيد افتتاحي", "Capital / opening balance", "EQUITY", C.EQUITY),
  acct(C.OWNER_DRAWINGS, "مسحوبات المالك", "Owner drawings", "EQUITY", C.EQUITY, { contra: true }),
  acct(C.RETAINED_EARNINGS, "الأرباح المحتجزة", "Retained earnings", "EQUITY", C.EQUITY),
  acct(C.REVENUE, "الإيرادات", "Revenue", "REVENUE", null, { header: true }),
  acct(C.SALES, "المبيعات", "Sales", "REVENUE", C.REVENUE),
  acct(C.SALES_RETURNS, "مرتجعات المبيعات", "Sales returns", "REVENUE", C.REVENUE, { contra: true }),
  acct(C.DISCOUNTS_ALLOWED, "خصومات ممنوحة", "Discounts allowed", "REVENUE", C.REVENUE, { contra: true }),
  acct(C.FX_GAIN, "أرباح فروق عملة", "FX gain", "REVENUE", C.REVENUE),
  acct(C.OTHER_INCOME, "إيرادات أخرى / زيادة جرد", "Other income / stock found", "REVENUE", C.REVENUE),
  acct(C.EXPENSES, "المصروفات", "Expenses", "EXPENSE", null, { header: true }),
  acct(C.COGS, "تكلفة البضاعة المباعة", "Cost of goods sold", "EXPENSE", C.EXPENSES),
  acct(C.PURCHASE_PRICE_VARIANCE, "فروق أسعار الشراء", "Purchase price variance", "EXPENSE", C.EXPENSES),
  acct(C.PURCHASE_RETURN_LOSS, "خسائر مرتجعات الشراء", "Purchase return loss", "EXPENSE", C.EXPENSES),
  acct(C.EXPIRY_WRITE_OFF, "خسائر انتهاء صلاحية", "Expiry write-off", "EXPENSE", C.EXPENSES),
  acct(C.INVENTORY_SHRINKAGE, "عجز جرد", "Inventory shrinkage", "EXPENSE", C.EXPENSES),
  acct(C.FX_LOSS, "خسائر فروق عملة", "FX loss", "EXPENSE", C.EXPENSES),
  acct(C.OPERATING_EXPENSES, "مصروفات تشغيلية", "Operating expenses", "EXPENSE", C.EXPENSES, { header: true }),
  acct(C.ELECTRICITY, "كهرباء", "Electricity", "EXPENSE", C.OPERATING_EXPENSES),
  acct(C.RENT, "إيجار", "Rent", "EXPENSE", C.OPERATING_EXPENSES),
  acct(C.OTHER_EXPENSES, "مصروفات أخرى (عجز صندوق)", "Other expenses (cash short)", "EXPENSE", C.OPERATING_EXPENSES),
  acct(C.SALARIES, "رواتب", "Salaries", "EXPENSE", C.OPERATING_EXPENSES),
  acct(C.BANK_FEES, "رسوم بنكية", "Bank fees", "EXPENSE", C.OPERATING_EXPENSES),
  acct(C.MAINTENANCE, "صيانة", "Maintenance", "EXPENSE", C.OPERATING_EXPENSES),
]);

const BY_CODE: ReadonlyMap<string, Account> = new Map(DEFAULT_CHART.map((a) => [a.code, a]));

export function findAccount(code: string): Account | undefined {
  return BY_CODE.get(code);
}

export function getAccount(code: string): Result<Account> {
  const a = BY_CODE.get(code);
  return a === undefined
    ? domainErr("accounting.unknown_account", `Unknown account code: ${code}`, { accountCode: code })
    : ok(a);
}

export function getPostableAccount(code: string): Result<Account> {
  const r = getAccount(code);
  if (!r.ok) return r;
  if (!r.value.isPostable) {
    return domainErr("accounting.account_not_postable", `Account ${code} is a header account`, { accountCode: code });
  }
  return r;
}

export function accountsByType(type: AccountType, opts: { readonly postableOnly?: boolean } = {}): readonly Account[] {
  return DEFAULT_CHART.filter((a) => a.type === type && (opts.postableOnly !== true || a.isPostable));
}

export function childrenOf(parentCode: string): readonly Account[] {
  return DEFAULT_CHART.filter((a) => a.parentCode === parentCode);
}

/** One cash GL account per currency; the cashbox is a line dimension (FR-CSH-101). */
export const CASH_ACCOUNT_BY_CURRENCY: Readonly<Record<CurrencyCode, string>> = Object.freeze({
  YER_NEW: C.CASH_YER_NEW,
  YER_OLD: C.CASH_YER_OLD,
  SAR: C.CASH_SAR,
  USD: C.CASH_USD,
});

export function cashAccountFor(currency: CurrencyCode): string {
  return CASH_ACCOUNT_BY_CURRENCY[currency];
}

const CASH_CODES: ReadonlySet<string> = new Set(Object.values(CASH_ACCOUNT_BY_CURRENCY));

export function isCashAccount(code: string): boolean {
  return CASH_CODES.has(code);
}

/** Structural validation for a (possibly tenant-customised) chart: unique codes, header parents, same type, no cycles. */
export function validateChart(accounts: readonly Account[]): Result<readonly Account[]> {
  const byCode = new Map<string, Account>();
  for (const a of accounts) {
    if (byCode.has(a.code)) {
      return domainErr("accounting.chart_duplicate_code", `Duplicate account code ${a.code}`, { accountCode: a.code });
    }
    byCode.set(a.code, a);
  }
  for (const a of accounts) {
    if (a.parentCode === null) continue;
    const parent = byCode.get(a.parentCode);
    if (parent === undefined) {
      return domainErr("accounting.chart_missing_parent", `Account ${a.code} references missing parent ${a.parentCode}`, {
        accountCode: a.code,
        parentCode: a.parentCode,
      });
    }
    if (parent.isPostable) {
      return domainErr("accounting.chart_parent_not_header", `Parent ${parent.code} of ${a.code} must be a header`, {
        accountCode: a.code,
        parentCode: parent.code,
      });
    }
    if (parent.type !== a.type) {
      return domainErr("accounting.chart_type_mismatch", `Account ${a.code} (${a.type}) differs from parent ${parent.code} (${parent.type})`, {
        accountCode: a.code,
        parentCode: parent.code,
      });
    }
    let cursor: Account | undefined = parent;
    while (cursor !== undefined && cursor.parentCode !== null) {
      if (cursor.parentCode === a.code) {
        return domainErr("accounting.chart_cycle", `Account ${a.code} is its own ancestor`, { accountCode: a.code });
      }
      cursor = byCode.get(cursor.parentCode);
    }
  }
  return ok(accounts);
}
