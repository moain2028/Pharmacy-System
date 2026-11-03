/**
 * Error-message localisation (ar/en). Codes are stable `prefix.detail` identifiers produced by the
 * domain (DomainError) and the API (ApiError). Exact codes win; otherwise the prefix family gives a
 * sensible message; the original English message is always kept in `messageEn` for support.
 */
export type Locale = "ar" | "en";

const EXACT: Record<string, { ar: string; en: string }> = {
  "auth.invalid_credentials": { ar: "اسم المستخدم أو كلمة المرور غير صحيحة", en: "Invalid username or password" },
  "auth.locked": { ar: "الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة", en: "Account temporarily locked after repeated failures" },
  "auth.unauthorized": { ar: "يلزم تسجيل الدخول", en: "Authentication required" },
  "auth.token_invalid": { ar: "انتهت الجلسة، سجّل الدخول من جديد", en: "Session expired, please sign in again" },
  "auth.permission_denied": { ar: "ليست لديك صلاحية لهذا الإجراء", en: "You do not have permission for this action" },
  "auth.elevation_denied": { ar: "بيانات المشرف غير صحيحة أو لا يملك الصلاحية", en: "Approver credentials invalid or lacking permission" },
  "auth.refresh_reused": { ar: "تم اكتشاف إعادة استخدام رمز التحديث — أُنهيت كل الجلسات", en: "Refresh token reuse detected — all sessions revoked" },
  "auth.user_inactive": { ar: "الحساب موقوف", en: "Account is inactive" },
  "validation.failed": { ar: "البيانات المدخلة غير صالحة", en: "Request validation failed" },
  "conflict.duplicate": { ar: "السجل موجود مسبقًا", en: "Record already exists" },
  "document.posted_immutable": { ar: "المستند مرحّل ولا يمكن تعديله", en: "Document is posted and cannot be modified" },
  "ledger.immutable": { ar: "سجل الحركات لا يقبل التعديل أو الحذف", en: "Ledger rows are append-only" },
  "lot.expired": { ar: "لا يمكن البيع من لوط منتهي الصلاحية", en: "Cannot sell from an expired lot" },
  "lot.not_sellable": { ar: "اللوط محجوز/محظور ولا يمكن البيع منه", en: "Lot is quarantined/blocked" },
  "stock.insufficient": { ar: "الكمية غير متوفرة في المخزون", en: "Insufficient stock" },
  "shifts.none_open": { ar: "لا توجد وردية مفتوحة — افتح وردية أولًا", en: "No open shift — open a shift first" },
  "shifts.not_open": { ar: "الوردية مغلقة بالفعل", en: "Shift is already closed" },
  "shifts.close_others_denied": { ar: "لا يمكنك إغلاق وردية كاشير آخر", en: "Cannot close another cashier's shift" },
  "shift.variance_approval_required": { ar: "فرق العهدة يتجاوز السماحية ويحتاج موافقة مشرف", en: "Variance above tolerance needs supervisor approval" },
  "shift.variance_reason_required": { ar: "فرق العهدة يحتاج سببًا", en: "Variance above tolerance needs a reason" },
  "fx.rate_missing": { ar: "لا يوجد سعر صرف لهذه العملة", en: "No exchange rate for this currency" },
  "sales.change_without_cash": { ar: "لا يمكن إعطاء باقٍ بدون دفعة نقدية", en: "Change requires a cash tender" },
  "sales.not_found": { ar: "الفاتورة غير موجودة", en: "Invoice not found" },
  "return.window_expired": { ar: "انتهت مهلة الإرجاع — يلزم إذن مشرف", en: "Return window expired; supervisor permission required" },
  "return.qty_exceeds_returnable": { ar: "الكمية المرتجعة أكبر من المباعة المتبقية", en: "Return quantity exceeds sold minus already returned" },
  "return.non_returnable": { ar: "هذا الصنف غير قابل للإرجاع", en: "Item is non-returnable" },
  "setup.already_initialized": { ar: "تم إعداد النظام مسبقًا", en: "System already initialized" },
  "setup.weak_password": { ar: "كلمة المرور ضعيفة", en: "Password too weak" },
  "items.not_found": { ar: "الصنف غير موجود", en: "Item not found" },
  "items.inactive": { ar: "الصنف موقوف", en: "Item is inactive" },
  "prices.missing": { ar: "لا يوجد سعر لهذه الوحدة", en: "No price for this unit" },
  "customers.not_found": { ar: "العميل غير موجود", en: "Customer not found" },
  "treasury.opening_already_posted": { ar: "الأرصدة الافتتاحية مرحّلة مسبقًا", en: "Opening balances already posted" },
  "supplier_invoices.duplicate_number": { ar: "رقم فاتورة المورد مستخدم مسبقًا لهذا المورد", en: "Supplier invoice number already used for this supplier" },
  "internal": { ar: "خطأ داخلي — أبلغ الدعم برقم الطلب", en: "Internal error — report the request id to support" },
};

const FAMILY: Record<string, { ar: string; en: string }> = {
  auth: { ar: "خطأ في المصادقة أو الصلاحيات", en: "Authentication/authorization error" },
  validation: { ar: "بيانات غير صالحة", en: "Invalid data" },
  sales: { ar: "قاعدة بيع غير مستوفاة", en: "Sales rule violated" },
  discount: { ar: "الخصم يتجاوز الحد المسموح", en: "Discount exceeds allowed limit" },
  payment: { ar: "خطأ في تسوية الدفع", en: "Payment settlement error" },
  return: { ar: "قاعدة إرجاع غير مستوفاة", en: "Return rule violated" },
  inventory: { ar: "قاعدة مخزون غير مستوفاة", en: "Inventory rule violated" },
  stock: { ar: "قاعدة مخزون غير مستوفاة", en: "Inventory rule violated" },
  lot: { ar: "خطأ في بيانات اللوط", en: "Lot error" },
  lots: { ar: "خطأ في بيانات اللوط", en: "Lot error" },
  uom: { ar: "خطأ في سلّم الوحدات", en: "Unit ladder error" },
  units: { ar: "خطأ في الوحدات", en: "Unit error" },
  qty: { ar: "كمية غير صالحة", en: "Invalid quantity" },
  money: { ar: "مبلغ غير صالح", en: "Invalid amount" },
  fx: { ar: "خطأ في سعر الصرف", en: "Exchange rate error" },
  accounting: { ar: "قيد محاسبي غير صالح", en: "Invalid journal entry" },
  journal: { ar: "قيد محاسبي غير صالح", en: "Invalid journal entry" },
  account: { ar: "حساب غير قابل للترحيل", en: "Account not postable" },
  shift: { ar: "قاعدة وردية غير مستوفاة", en: "Shift rule violated" },
  shifts: { ar: "قاعدة وردية غير مستوفاة", en: "Shift rule violated" },
  cash: { ar: "حركة نقدية غير صالحة", en: "Invalid cash movement" },
  cashbox: { ar: "خطأ في الصندوق", en: "Cashbox error" },
  treasury: { ar: "عملية خزينة غير صالحة", en: "Invalid treasury operation" },
  po: { ar: "قاعدة أمر شراء غير مستوفاة", en: "Purchase order rule violated" },
  grn: { ar: "قاعدة استلام غير مستوفاة", en: "Goods receipt rule violated" },
  supinv: { ar: "فاتورة المورد لا تطابق الاستلام", en: "Supplier invoice matching error" },
  supplier_invoices: { ar: "خطأ في فاتورة المورد", en: "Supplier invoice error" },
  purchase_return: { ar: "قاعدة مرتجع شراء غير مستوفاة", en: "Purchase return rule violated" },
  ledger: { ar: "خطأ في دفتر الذمم", en: "Ledger error" },
  reorder: { ar: "خطأ في اقتراح إعادة الطلب", en: "Reorder suggestion error" },
  iam: { ar: "خطأ في الأدوار/الصلاحيات", en: "Roles/permissions error" },
  password: { ar: "كلمة المرور لا تستوفي الشروط", en: "Password policy not met" },
  pin: { ar: "رمز PIN غير صالح", en: "Invalid PIN" },
  users: { ar: "خطأ في المستخدم", en: "User error" },
  roles: { ar: "خطأ في الدور", en: "Role error" },
  items: { ar: "خطأ في الصنف", en: "Item error" },
  barcodes: { ar: "باركود غير صالح", en: "Invalid barcode" },
  prices: { ar: "خطأ في التسعير", en: "Pricing error" },
  customers: { ar: "خطأ في بيانات العميل", en: "Customer error" },
  setup: { ar: "خطأ في الإعداد", en: "Setup error" },
  audit: { ar: "خطأ في سجل التدقيق", en: "Audit error" },
  date: { ar: "تاريخ غير صالح", en: "Invalid date" },
  conflict: { ar: "تعارض", en: "Conflict" },
  document: { ar: "خطأ في المستند", en: "Document error" },
  db: { ar: "خطأ في قاعدة البيانات", en: "Database error" },
};

export function localize(code: string, locale: Locale, fallbackEn: string): string {
  const exact = EXACT[code];
  if (exact) return exact[locale];
  const fam = FAMILY[code.split(".")[0] ?? ""];
  if (fam) return locale === "ar" ? fam.ar : fallbackEn || fam.en;
  return locale === "ar" ? "حدث خطأ" : fallbackEn || "Error";
}

/** Locale from the authenticated principal, else Accept-Language, else Arabic (primary market). */
export function pickLocale(principalLocale: string | undefined, acceptLanguage: string | undefined): Locale {
  if (principalLocale === "ar" || principalLocale === "en") return principalLocale;
  const al = (acceptLanguage ?? "").toLowerCase();
  if (al.startsWith("en")) return "en";
  return "ar";
}
