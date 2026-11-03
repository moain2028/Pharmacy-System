import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import { CURRENCY_CODES, type CurrencyCode } from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { hashPassword } from "./password.js";
import { BUILTIN_ROLES } from "./permissions.js";

export interface SetupInput {
  readonly pharmacy: { nameAr: string; nameEn: string; baseCurrency: CurrencyCode; officialPricePolicy?: "BLOCK" | "BLOCK_WITH_OVERRIDE" | "WARN" | undefined; cashRoundStepMinor?: number | undefined };
  readonly owner: { username: string; displayName: string; password: string; locale?: "ar" | "en" | undefined; pin?: string | undefined };
}

/** Default chart of accounts for a small pharmacy (ACCOUNTING-DESIGN §2). Codes are stable system keys. */
export const DEFAULT_ACCOUNTS: ReadonlyArray<{ code: string; ar: string; en: string; side: "DEBIT" | "CREDIT"; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; parent?: string; postable?: boolean; dim?: string }> = [
  { code: "1000", ar: "الأصول", en: "Assets", side: "DEBIT", type: "ASSET", postable: false },
  { code: "1010", ar: "الصناديق", en: "Cash on hand", side: "DEBIT", type: "ASSET", parent: "1000", dim: "cashbox" },
  { code: "1020", ar: "البنوك والمحافظ", en: "Bank & wallets", side: "DEBIT", type: "ASSET", parent: "1000", dim: "cashbox" },
  { code: "1100", ar: "ذمم العملاء", en: "Accounts receivable", side: "DEBIT", type: "ASSET", parent: "1000", dim: "customer" },
  { code: "1200", ar: "المخزون", en: "Inventory", side: "DEBIT", type: "ASSET", parent: "1000", dim: "item" },
  { code: "1300", ar: "ضريبة مدخلات", en: "Input tax", side: "DEBIT", type: "ASSET", parent: "1000" },
  { code: "2000", ar: "الخصوم", en: "Liabilities", side: "CREDIT", type: "LIABILITY", postable: false },
  { code: "2100", ar: "ذمم الموردين", en: "Accounts payable", side: "CREDIT", type: "LIABILITY", parent: "2000", dim: "supplier" },
  { code: "2200", ar: "ضريبة مخرجات", en: "Output tax", side: "CREDIT", type: "LIABILITY", parent: "2000" },
  { code: "2300", ar: "أرصدة عملاء دائنة", en: "Customer credits", side: "CREDIT", type: "LIABILITY", parent: "2000", dim: "customer" },
  { code: "3000", ar: "حقوق الملكية", en: "Equity", side: "CREDIT", type: "EQUITY", postable: false },
  { code: "3010", ar: "رأس المال", en: "Capital", side: "CREDIT", type: "EQUITY", parent: "3000" },
  { code: "3020", ar: "مسحوبات المالك", en: "Owner drawings", side: "DEBIT", type: "EQUITY", parent: "3000" },
  { code: "3030", ar: "أرباح مرحلة", en: "Retained earnings", side: "CREDIT", type: "EQUITY", parent: "3000" },
  { code: "3900", ar: "رصيد افتتاحي", en: "Opening balance equity", side: "CREDIT", type: "EQUITY", parent: "3000" },
  { code: "4000", ar: "الإيرادات", en: "Revenue", side: "CREDIT", type: "REVENUE", postable: false },
  { code: "4010", ar: "المبيعات", en: "Sales", side: "CREDIT", type: "REVENUE", parent: "4000" },
  { code: "4020", ar: "مردودات المبيعات", en: "Sales returns", side: "DEBIT", type: "REVENUE", parent: "4000" },
  { code: "4030", ar: "خصومات المبيعات", en: "Sales discounts", side: "DEBIT", type: "REVENUE", parent: "4000" },
  { code: "4040", ar: "فروق تقريب", en: "Rounding differences", side: "CREDIT", type: "REVENUE", parent: "4000" },
  { code: "4050", ar: "أرباح/خسائر صرف", en: "FX gain/loss", side: "CREDIT", type: "REVENUE", parent: "4000" },
  { code: "4060", ar: "إيرادات أخرى", en: "Other income", side: "CREDIT", type: "REVENUE", parent: "4000" },
  { code: "5000", ar: "المصروفات", en: "Expenses", side: "DEBIT", type: "EXPENSE", postable: false },
  { code: "5010", ar: "تكلفة البضاعة المباعة", en: "Cost of goods sold", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5020", ar: "خسائر الانتهاء والتلف", en: "Expiry & damage losses", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5030", ar: "فروق الجرد", en: "Stocktake variances", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5040", ar: "عجز/زيادة الصندوق", en: "Cash over/short", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5100", ar: "الرواتب", en: "Salaries", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5110", ar: "الإيجار", en: "Rent", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5120", ar: "الكهرباء والماء", en: "Utilities", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5130", ar: "اتصالات وإنترنت", en: "Telecom & internet", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5140", ar: "نقل وشحن", en: "Transport & freight", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5150", ar: "رسوم وتراخيص", en: "Fees & licenses", side: "DEBIT", type: "EXPENSE", parent: "5000" },
  { code: "5190", ar: "مصروفات أخرى", en: "Other expenses", side: "DEBIT", type: "EXPENSE", parent: "5000" },
];

@Injectable()
export class SetupService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async status(): Promise<{ initialized: boolean; tenants: Array<{ id: string; nameAr: string; nameEn: string }> }> {
    const rows = await this.db.admin()<{ id: string; name_ar: string; name_en: string }[]>`SELECT id, name_ar, name_en FROM tenants ORDER BY created_at`;
    return { initialized: rows.length > 0, tenants: rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en })) };
  }

  /**
   * Brand-new pharmacy wizard (D-030): creates tenant, built-in roles, owner user, default chart of
   * accounts, main location, main register, default price list, walk-in customer, numbering series.
   * Refuses when a tenant already exists (single-pharmacy install) unless `allowAdditional`.
   */
  async initialize(input: SetupInput, allowAdditional = false): Promise<{ tenantId: string; ownerId: string }> {
    if (!CURRENCY_CODES.includes(input.pharmacy.baseCurrency)) throw ApiError.badRequest("setup.invalid_currency", "Unknown base currency");
    if (input.owner.password.length < 8) throw ApiError.badRequest("setup.weak_password", "Owner password must be at least 8 characters");
    const admin = this.db.admin();
    const existing = await admin`SELECT 1 FROM tenants LIMIT 1`;
    if (existing.length > 0 && !allowAdditional) throw ApiError.conflict("setup.already_initialized", "This installation is already initialized");
    const passwordHash = await hashPassword(input.owner.password);
    const pinHash = input.owner.pin ? await hashPassword(input.owner.pin) : null;

    return admin.begin(async (raw) => {
      const tx = raw as unknown as Sql;
      const [t] = await tx<{ id: string }[]>`INSERT INTO tenants (name_ar, name_en, base_currency, official_price_policy, cash_round_step_minor)
        VALUES (${input.pharmacy.nameAr}, ${input.pharmacy.nameEn}, ${input.pharmacy.baseCurrency}::currency_code,
                ${input.pharmacy.officialPricePolicy ?? "BLOCK_WITH_OVERRIDE"}::official_price_policy, ${input.pharmacy.cashRoundStepMinor ?? 0}) RETURNING id`;
      const tenantId = t!.id;
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      const roleIds: Record<string, string> = {};
      for (const [code, r] of Object.entries(BUILTIN_ROLES)) {
        const [row] = await tx<{ id: string }[]>`INSERT INTO roles (tenant_id, code, name_ar, name_en, is_system, permissions, limits)
          VALUES (${tenantId}, ${code}, ${r.nameAr}, ${r.nameEn}, true, ${tx.array([...r.permissions])}, ${tx.json(r.limits)}) RETURNING id`;
        roleIds[code] = row!.id;
      }
      const [owner] = await tx<{ id: string }[]>`INSERT INTO users (tenant_id, username, display_name, password_hash, pin_hash, locale)
        VALUES (${tenantId}, ${input.owner.username}, ${input.owner.displayName}, ${passwordHash}, ${pinHash}, ${input.owner.locale ?? "ar"}) RETURNING id`;
      await tx`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES (${tenantId}, ${owner!.id}, ${roleIds["OWNER"]!})`;

      for (const a of DEFAULT_ACCOUNTS) {
        await tx`INSERT INTO accounts (tenant_id, code, name_ar, name_en, parent_code, normal_balance, account_type, is_postable, is_system, dimension_hint)
          VALUES (${tenantId}, ${a.code}, ${a.ar}, ${a.en}, ${a.parent ?? null}, ${a.side}::account_side, ${a.type}, ${a.postable ?? true}, true, ${a.dim ?? null})`;
      }
      await tx`INSERT INTO locations (tenant_id, code, name_ar, name_en, kind) VALUES
        (${tenantId}, 'MAIN', 'الصالة الرئيسية', 'Main floor', 'SHELF'),
        (${tenantId}, 'FRIDGE', 'الثلاجة', 'Fridge', 'FRIDGE'),
        (${tenantId}, 'STORE', 'المخزن', 'Back store', 'BACKSTORE'),
        (${tenantId}, 'QUARANTINE', 'الحجر', 'Quarantine', 'QUARANTINE')`;
      await tx`UPDATE locations SET is_sellable = false WHERE tenant_id = ${tenantId} AND code = 'QUARANTINE'`;
      await tx`INSERT INTO cashboxes (tenant_id, code, name_ar, name_en, kind) VALUES
        (${tenantId}, 'REG1', 'الصندوق 1', 'Register 1', 'REGISTER'),
        (${tenantId}, 'SAFE', 'الخزنة', 'Safe', 'SAFE')`;
      await tx`INSERT INTO price_lists (tenant_id, code, name_ar, name_en, currency, kind, priority)
        VALUES (${tenantId}, 'RETAIL', 'قائمة التجزئة', 'Retail', ${input.pharmacy.baseCurrency}::currency_code, 'RETAIL', 1000)`;
      await tx`INSERT INTO customers (tenant_id, code, name, is_walk_in) VALUES (${tenantId}, 'WALKIN', 'عميل نقدي / Walk-in', true)`;
      await tx`INSERT INTO expense_categories (tenant_id, code, name_ar, name_en, account_code) VALUES
        (${tenantId}, 'SALARY', 'رواتب', 'Salaries', '5100'), (${tenantId}, 'RENT', 'إيجار', 'Rent', '5110'),
        (${tenantId}, 'UTIL', 'كهرباء وماء', 'Utilities', '5120'), (${tenantId}, 'TELECOM', 'اتصالات', 'Telecom', '5130'),
        (${tenantId}, 'TRANSPORT', 'نقل', 'Transport', '5140'), (${tenantId}, 'FEES', 'رسوم وتراخيص', 'Fees & licenses', '5150'),
        (${tenantId}, 'OTHER', 'أخرى', 'Other', '5190')`;
      for (const [type, prefix] of [["SALES_INVOICE", "INV-"], ["SALES_RETURN", "RET-"], ["PURCHASE_ORDER", "PO-"], ["GOODS_RECEIPT", "GRN-"], ["SUPPLIER_INVOICE", "SINV-"], ["PURCHASE_RETURN", "PRET-"], ["PAYMENT", "PAY-"], ["EXPENSE", "EXP-"], ["STOCKTAKE", "STK-"], ["ADJUSTMENT", "ADJ-"], ["JOURNAL", "JE-"]] as const) {
        await tx`INSERT INTO numbering_series (tenant_id, document_type, period_key, prefix, padding) VALUES (${tenantId}, ${type}, '', ${prefix}, 6)`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
        VALUES (${tenantId}, ${owner!.id}, 'setup.initialize', 'tenant', ${tenantId}, ${tx.json({ nameAr: input.pharmacy.nameAr, baseCurrency: input.pharmacy.baseCurrency })})`;
      return { tenantId, ownerId: owner!.id };
    }) as Promise<{ tenantId: string; ownerId: string }>;
  }
}
