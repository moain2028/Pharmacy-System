/**
 * Permission catalog — FR-IAM-102..105.
 * Keys are canonical `resource.action` strings grouped by resource; this file is the single source
 * of truth for `role_permissions.permission_key` and `user_permission_overrides.permission_key`.
 *
 * `numericLimit` names the bound stored in `limit_value` for that permission (FR-IAM-104):
 *   max_discount_bp          sale.discount_line, sale.discount_invoice  (basis points, 10 000 = 100 %)
 *   max_price_change_bp      sale.edit_price                            (|deviation| from list price)
 *   max_void_amount_minor    sale.void                                  (base-currency minor units)
 *   max_expense_amount_minor cash.expense                               (base-currency minor units)
 */
export const LIMIT_NAMES = [
  "max_discount_bp",
  "max_price_change_bp",
  "max_void_amount_minor",
  "max_expense_amount_minor",
] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];

export function isLimitName(x: unknown): x is LimitName {
  return typeof x === "string" && (LIMIT_NAMES as readonly string[]).includes(x);
}

/** Basis-point limits bound percentages; the others bound money minor amounts. */
export function isBpLimit(name: LimitName): boolean {
  return name.endsWith("_bp");
}

export interface PermissionLeaf {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly numericLimit?: LimitName;
}

const p = (nameAr: string, nameEn: string, numericLimit?: LimitName): PermissionLeaf =>
  Object.freeze(numericLimit === undefined ? { nameAr, nameEn } : { nameAr, nameEn, numericLimit });

/** The catalog grouped by resource. Add new actions here only (keys become `group.action`). */
export const PERMISSION_CATALOG = {
  catalog: {
    view: p("عرض الأصناف", "View items"),
    create: p("إضافة صنف", "Create item"),
    edit: p("تعديل صنف", "Edit item"),
    deactivate: p("إيقاف صنف", "Deactivate item"),
    edit_price: p("تعديل أسعار البيع", "Edit selling prices"),
    manage_units: p("إدارة وحدات الصنف", "Manage item units"),
    manage_barcodes: p("إدارة الباركودات", "Manage barcodes"),
    print_labels: p("طباعة ملصقات الأصناف", "Print item labels"),
    import: p("استيراد الأصناف", "Import items"),
    export: p("تصدير الأصناف", "Export items"),
  },
  inventory: {
    view: p("عرض المخزون", "View stock"),
    view_cost: p("عرض التكلفة", "View cost"),
    receive: p("استلام بضاعة", "Receive stock"),
    adjust: p("تسوية مخزون", "Adjust stock"),
    count: p("جرد", "Stock count"),
    transfer: p("تحويل بين المواقع", "Transfer between locations"),
    manage_lots: p("إدارة الدفعات", "Manage lots"),
    override_fefo: p("تجاوز FEFO", "Override FEFO"),
    print_labels: p("طباعة ملصقات الدفعات", "Print lot labels"),
  },
  sale: {
    create: p("إنشاء فاتورة بيع", "Create sale"),
    post: p("ترحيل فاتورة بيع", "Post sale"),
    discount_line: p("خصم سطر", "Line discount", "max_discount_bp"),
    discount_invoice: p("خصم فاتورة", "Invoice discount", "max_discount_bp"),
    edit_price: p("تعديل سعر البيع في الفاتورة", "Edit price on sale", "max_price_change_bp"),
    override_official_price: p("البيع فوق السعر الرسمي", "Sell above official price"),
    credit: p("بيع آجل", "Credit sale"),
    void_draft: p("إلغاء مسودة فاتورة", "Void draft sale"),
    void: p("عكس فاتورة مرحّلة", "Void posted sale", "max_void_amount_minor"),
    return: p("مرتجع بيع", "Sales return"),
    reprint: p("إعادة طباعة فاتورة", "Reprint sale"),
    view_cost: p("عرض سعر الشراء في شاشة البيع", "View purchase price on POS"),
  },
  purchase: {
    view: p("عرض المشتريات", "View purchases"),
    order: p("أمر شراء", "Purchase order"),
    create: p("إنشاء فاتورة شراء", "Create purchase"),
    post: p("ترحيل فاتورة شراء", "Post purchase"),
    return: p("مرتجع شراء", "Purchase return"),
  },
  cash: {
    open_shift: p("فتح وردية", "Open shift"),
    close_shift: p("إغلاق الوردية الخاصة", "Close own shift"),
    close_other_shift: p("إغلاق وردية مستخدم آخر", "Close another user's shift"),
    view_all_shifts: p("عرض كل الورديات", "View all shifts"),
    receipt: p("سند قبض", "Cash receipt"),
    expense: p("سند صرف / مصروف", "Cash expense", "max_expense_amount_minor"),
    transfer: p("تحويل نقدي بين الصناديق", "Cash transfer"),
    exchange: p("صرف عملات", "Currency exchange"),
    count: p("جرد الصندوق", "Cash count"),
  },
  customer: {
    view: p("عرض الزبائن", "View customers"),
    create: p("إضافة زبون", "Create customer"),
    edit: p("تعديل زبون", "Edit customer"),
    edit_limit: p("تعديل حد الائتمان", "Edit credit limit"),
    receive_payment: p("تحصيل من زبون", "Receive customer payment"),
    view_statement: p("كشف حساب زبون", "Customer statement"),
    export: p("تصدير الزبائن", "Export customers"),
  },
  supplier: {
    view: p("عرض الموردين", "View suppliers"),
    create: p("إضافة مورد", "Create supplier"),
    edit: p("تعديل مورد", "Edit supplier"),
    pay: p("سداد مورد", "Pay supplier"),
    view_statement: p("كشف حساب مورد", "Supplier statement"),
  },
  report: {
    sales: p("تقارير المبيعات", "Sales reports"),
    inventory: p("تقارير المخزون", "Inventory reports"),
    expiry: p("تقارير الانتهاء", "Expiry reports"),
    financial: p("التقارير المالية", "Financial reports"),
    profit: p("تقارير الأرباح", "Profit reports"),
    cost: p("تقارير التكلفة", "Cost reports"),
    export: p("تصدير التقارير", "Export reports"),
  },
  settings: {
    view: p("عرض الإعدادات", "View settings"),
    edit: p("تعديل الإعدادات العامة", "Edit general settings"),
    currencies: p("إدارة العملات وأسعار الصرف", "Manage currencies and rates"),
    tax: p("إعدادات الضريبة", "Tax settings"),
    numbering: p("سلاسل الترقيم", "Numbering series"),
    printers: p("إعدادات الطابعات", "Printer settings"),
    devices: p("إدارة الأجهزة", "Manage devices"),
  },
  user: {
    view: p("عرض المستخدمين", "View users"),
    manage: p("إدارة المستخدمين", "Manage users"),
    assign_roles: p("إسناد الأدوار والصلاحيات", "Assign roles and permissions"),
    reset_password: p("إعادة تعيين كلمة مرور", "Reset password"),
    manage_pin: p("إدارة PIN المدير", "Manage manager PIN"),
    view_login_log: p("عرض سجل الدخول", "View login log"),
    end_session: p("إنهاء جلسة", "End session"),
  },
  backup: {
    create: p("إنشاء نسخة احتياطية", "Create backup"),
    restore: p("استعادة نسخة احتياطية", "Restore backup"),
    configure: p("إعداد النسخ الاحتياطي", "Configure backup"),
  },
  accounting: {
    view: p("عرض الحسابات", "View accounting"),
    journal_create: p("إنشاء قيد", "Create journal entry"),
    journal_post: p("ترحيل قيد", "Post journal entry"),
    journal_reverse: p("عكس قيد", "Reverse journal entry"),
    close_period: p("إقفال فترة", "Close period"),
    chart_edit: p("تعديل دليل الحسابات", "Edit chart of accounts"),
  },
  audit: {
    view: p("عرض سجل التدقيق", "View audit log"),
    export: p("تصدير سجل التدقيق", "Export audit log"),
  },
} satisfies Readonly<Record<string, Readonly<Record<string, PermissionLeaf>>>>;

type Catalog = typeof PERMISSION_CATALOG;
export type PermissionGroup = keyof Catalog & string;
/** Every `resource.action` key, derived at type level from the catalog. */
export type PermissionKey = { [G in PermissionGroup]: `${G}.${keyof Catalog[G] & string}` }[PermissionGroup];

export interface PermissionDef {
  readonly key: PermissionKey;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly group: PermissionGroup;
  readonly numericLimit?: LimitName;
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = Object.freeze(
  Object.keys(PERMISSION_CATALOG) as PermissionGroup[],
);

function flatten(): Readonly<Record<PermissionKey, PermissionDef>> {
  const out: Partial<Record<PermissionKey, PermissionDef>> = {};
  for (const group of PERMISSION_GROUPS) {
    const actions: Readonly<Record<string, PermissionLeaf>> = PERMISSION_CATALOG[group];
    for (const [action, leaf] of Object.entries(actions)) {
      const key = `${group}.${action}` as PermissionKey;
      out[key] = Object.freeze(
        leaf.numericLimit === undefined
          ? { key, nameAr: leaf.nameAr, nameEn: leaf.nameEn, group }
          : { key, nameAr: leaf.nameAr, nameEn: leaf.nameEn, group, numericLimit: leaf.numericLimit },
      );
    }
  }
  return Object.freeze(out as Record<PermissionKey, PermissionDef>);
}

/** Flat catalog: `PERMISSIONS["sale.discount_line"]` → definition. */
export const PERMISSIONS: Readonly<Record<PermissionKey, PermissionDef>> = flatten();
export const PERMISSION_KEYS: readonly PermissionKey[] = Object.freeze(Object.keys(PERMISSIONS) as PermissionKey[]);

export function isPermissionKey(x: unknown): x is PermissionKey {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(PERMISSIONS, x);
}

export function permissionsByGroup(group: PermissionGroup): readonly PermissionDef[] {
  return Object.freeze(PERMISSION_KEYS.map((k) => PERMISSIONS[k]).filter((d) => d.group === group));
}

/** Permissions that carry a numeric limit (FR-IAM-104). */
export function limitedPermissions(): readonly PermissionDef[] {
  return Object.freeze(PERMISSION_KEYS.map((k) => PERMISSIONS[k]).filter((d) => d.numericLimit !== undefined));
}

/** Permissions bound by a given limit name (e.g. both discount permissions share max_discount_bp). */
export function permissionsForLimit(name: LimitName): readonly PermissionKey[] {
  return Object.freeze(PERMISSION_KEYS.filter((k) => PERMISSIONS[k].numericLimit === name));
}
