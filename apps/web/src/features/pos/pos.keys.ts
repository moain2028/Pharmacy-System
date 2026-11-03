import { useT } from "@/i18n";

export const posAr: Record<string, string> = {
  "pos.noResults": "لا توجد أصناف مطابقة", "pos.empty": "السلة فارغة — امسح الباركود أو ابحث عن صنف", "pos.item": "الصنف",
  "pos.remove": "حذف السطر", "pos.qtyDec": "إنقاص الكمية", "pos.qtyInc": "زيادة الكمية", "pos.lineDiscPct": "خصم %",
  "pos.invDiscPct": "خصم الفاتورة %", "pos.gross": "الإجمالي قبل الخصم", "pos.lineDiscounts": "خصومات الأصناف", "pos.invDiscount": "خصم الفاتورة",
  "pos.rounding": "فرق التقريب", "pos.recalc": "جارٍ إعادة الحساب…", "pos.addTender": "إضافة دفعة", "pos.removeTender": "حذف الدفعة",
  "pos.method": "طريقة الدفع", "pos.exact": "المبلغ بالضبط", "pos.roundUp": "تقريب للأعلى", "pos.paymentRef": "المرجع",
  "pos.confirmPay": "تأكيد الدفع (Enter)", "pos.creditNeedsCustomer": "البيع الآجل يتطلب اختيار عميل مسجّل", "pos.invalidAmount": "مبلغ غير صالح",
  "pos.newSale": "فاتورة جديدة (Enter)", "pos.heldList": "الفواتير المعلّقة", "pos.resume": "استئناف", "pos.heldOk": "تم تعليق الفاتورة",
  "pos.nothingToHold": "السلة فارغة", "pos.confirmClear": "هل تريد إفراغ السلة الحالية؟", "pos.noShift": "يجب فتح وردية قبل البيع",
  "pos.itemNotFound": "لم يُعثر على صنف لهذا الباركود", "pos.noSellUnit": "لا توجد وحدة بيع لهذا الصنف", "pos.overrideHint": "هذه العملية تتطلب موافقة المدير",
  "pos.ovBelowMin": "أقل من الحد الأدنى للسعر", "pos.ovBelowCost": "أقل من التكلفة", "pos.ovAboveOfficial": "أعلى من السعر الرسمي", "pos.ovCredit": "تجاوز سقف الذمم",
  "pos.approve": "اعتماد وإرسال", "pos.shiftOpen": "الوردية مفتوحة", "pos.cashbox": "الصندوق", "pos.openedAt": "وقت الفتح",
  "pos.salesCount": "عدد الفواتير", "pos.zReport": "تقرير Z", "pos.varianceReason": "سبب الفرق", "pos.approverOpt": "المعتمِد (اختياري)",
  "pos.shiftClosed": "تم إغلاق الوردية", "pos.shiftOpened": "تم فتح الوردية", "pos.selectCashbox": "اختر الصندوق", "pos.searchCustomer": "ابحث عن عميل",
  "pos.changeDue": "الباقي للعميل", "pos.lineTotal": "الإجمالي", "pos.reasonRequired": "يجب ذكر سبب الفرق", "pos.noHeld": "لا توجد فواتير معلّقة",
};

export const posEn: Record<string, string> = {
  "pos.noResults": "No matching items", "pos.empty": "Cart is empty — scan or search an item", "pos.item": "Item",
  "pos.remove": "Remove line", "pos.qtyDec": "Decrease quantity", "pos.qtyInc": "Increase quantity", "pos.lineDiscPct": "Disc. %",
  "pos.invDiscPct": "Invoice discount %", "pos.gross": "Gross", "pos.lineDiscounts": "Line discounts", "pos.invDiscount": "Invoice discount",
  "pos.rounding": "Rounding", "pos.recalc": "Recalculating…", "pos.addTender": "Add payment", "pos.removeTender": "Remove payment",
  "pos.method": "Method", "pos.exact": "Exact", "pos.roundUp": "Round up", "pos.paymentRef": "Reference",
  "pos.confirmPay": "Confirm payment (Enter)", "pos.creditNeedsCustomer": "On-account sale requires a named customer", "pos.invalidAmount": "Invalid amount",
  "pos.newSale": "New sale (Enter)", "pos.heldList": "Held carts", "pos.resume": "Resume", "pos.heldOk": "Cart held",
  "pos.nothingToHold": "Cart is empty", "pos.confirmClear": "Clear the current cart?", "pos.noShift": "Open a shift before selling",
  "pos.itemNotFound": "No item found for this barcode", "pos.noSellUnit": "This item has no sellable unit", "pos.overrideHint": "This sale needs manager approval",
  "pos.ovBelowMin": "Below minimum price", "pos.ovBelowCost": "Below cost", "pos.ovAboveOfficial": "Above official price", "pos.ovCredit": "Credit limit exceeded",
  "pos.approve": "Approve & submit", "pos.shiftOpen": "Shift open", "pos.cashbox": "Cashbox", "pos.openedAt": "Opened",
  "pos.salesCount": "Sales count", "pos.zReport": "Z report", "pos.varianceReason": "Variance reason", "pos.approverOpt": "Approver (optional)",
  "pos.shiftClosed": "Shift closed", "pos.shiftOpened": "Shift opened", "pos.selectCashbox": "Select a cashbox", "pos.searchCustomer": "Search customer",
  "pos.changeDue": "Change due", "pos.lineTotal": "Line total", "pos.reasonRequired": "A reason is required for each variance", "pos.noHeld": "No held carts",
};

/** Feature-local translator: POS keys first, then the global dictionaries. */
export function usePosT() {
  const base = useT();
  const dict = base.locale === "ar" ? posAr : posEn;
  const t = (key: string): string => dict[key] ?? base.t(key);
  return { t, locale: base.locale, dir: base.dir };
}
