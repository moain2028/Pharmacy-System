import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import { CURRENCY_CODES, DEFAULT_CHART, type CurrencyCode } from "@pharmacore/domain";
import { CONFIG, type AppConfig } from "../infra/config.js";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { hashPassword } from "./password.js";
import { BUILTIN_ROLES } from "./permissions.js";

export interface SetupInput {
  readonly pharmacy: { nameAr: string; nameEn: string; baseCurrency: CurrencyCode; officialPricePolicy?: "BLOCK" | "BLOCK_WITH_OVERRIDE" | "WARN" | undefined; cashRoundStepMinor?: number | undefined };
  readonly owner: { username: string; displayName: string; password: string; locale?: "ar" | "en" | undefined; pin?: string | undefined };
}

/** Chart of accounts = the domain's canonical DEFAULT_CHART (single source of truth for posting rules). */
const CHART = DEFAULT_CHART;
/** Tenant-level extras used by the setup wizard and expense categories (children of canonical headers). */
const EXTRA_ACCOUNTS: ReadonlyArray<{ code: string; ar: string; en: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; side: "DEBIT" | "CREDIT"; parent: string }> = [
  { code: "5570", ar: "اتصالات وإنترنت", en: "Telecom & internet", type: "EXPENSE", side: "DEBIT", parent: "5500" },
  { code: "5580", ar: "نقل وشحن", en: "Transport & freight", type: "EXPENSE", side: "DEBIT", parent: "5500" },
  { code: "5590", ar: "رسوم وتراخيص", en: "Fees & licenses", type: "EXPENSE", side: "DEBIT", parent: "5500" },
];

@Injectable()
export class SetupService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CONFIG) private readonly cfg: AppConfig) {}

  async status(): Promise<{ initialized: boolean; demo: boolean; tenants: Array<{ id: string; nameAr: string; nameEn: string }> }> {
    const rows = await this.db.admin()<{ id: string; name_ar: string; name_en: string }[]>`SELECT id, name_ar, name_en FROM tenants ORDER BY created_at`;
    return { initialized: rows.length > 0, demo: this.cfg.DEMO_MODE, tenants: rows.map((r) => ({ id: r.id, nameAr: r.name_ar, nameEn: r.name_en })) };
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

      const dim = (code: string): string | null => (code === "1300" ? "customer" : code === "2100" ? "supplier" : code === "1400" ? "item" : code.startsWith("11") || code.startsWith("12") ? "cashbox" : null);
      for (const a of CHART) {
        await tx`INSERT INTO accounts (tenant_id, code, name_ar, name_en, parent_code, normal_balance, account_type, is_postable, is_system, dimension_hint)
          VALUES (${tenantId}, ${a.code}, ${a.nameAr}, ${a.nameEn}, ${a.parentCode}, ${a.normalBalance}::account_side, ${a.type}, ${a.isPostable}, true, ${dim(a.code)})`;
      }
      for (const a of EXTRA_ACCOUNTS) {
        await tx`INSERT INTO accounts (tenant_id, code, name_ar, name_en, parent_code, normal_balance, account_type, is_postable, is_system, dimension_hint)
          VALUES (${tenantId}, ${a.code}, ${a.ar}, ${a.en}, ${a.parent}, ${a.side}::account_side, ${a.type}, true, true, null)`;
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
        (${tenantId}, 'SALARY', 'رواتب', 'Salaries', '5540'), (${tenantId}, 'RENT', 'إيجار', 'Rent', '5520'),
        (${tenantId}, 'UTIL', 'كهرباء وماء', 'Utilities', '5510'), (${tenantId}, 'TELECOM', 'اتصالات', 'Telecom', '5570'),
        (${tenantId}, 'TRANSPORT', 'نقل', 'Transport', '5580'), (${tenantId}, 'FEES', 'رسوم وتراخيص', 'Fees & licenses', '5590'),
        (${tenantId}, 'MAINT', 'صيانة', 'Maintenance', '5560'), (${tenantId}, 'BANK', 'رسوم بنكية', 'Bank fees', '5550'),
        (${tenantId}, 'OTHER', 'أخرى', 'Other', '5530')`;
      for (const [type, prefix] of [["SALES_INVOICE", "INV-"], ["SALES_RETURN", "RET-"], ["PURCHASE_ORDER", "PO-"], ["GOODS_RECEIPT", "GRN-"], ["SUPPLIER_INVOICE", "SINV-"], ["PURCHASE_RETURN", "PRET-"], ["PAYMENT", "PAY-"], ["EXPENSE", "EXP-"], ["STOCKTAKE", "STK-"], ["ADJUSTMENT", "ADJ-"], ["JOURNAL", "JE-"], ["ITEM", "IT-"], ["INTERNAL_BARCODE", ""], ["SHIFT", ""], ["Z_REPORT", ""]] as const) {
        await tx`INSERT INTO numbering_series (tenant_id, document_type, period_key, prefix, padding) VALUES (${tenantId}, ${type}, '', ${prefix}, 6)`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
        VALUES (${tenantId}, ${owner!.id}, 'setup.initialize', 'tenant', ${tenantId}, ${tx.json({ nameAr: input.pharmacy.nameAr, baseCurrency: input.pharmacy.baseCurrency })})`;
      return { tenantId, ownerId: owner!.id };
    }) as Promise<{ tenantId: string; ownerId: string }>;
  }
}
