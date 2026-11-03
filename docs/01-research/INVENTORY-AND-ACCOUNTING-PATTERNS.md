# R6 — أنماط المخزون والمحاسبة (Immutable Ledger · Double-Entry · Lot/FEFO · Units)

> **الهدف:** تثبيت الأنماط الهندسية التي تجعل المخزون والحسابات **صحيحة بالبناء** (correct by construction) لا بالانضباط البشري. هذه الوثيقة هي الأساس النظري لـ `docs/05-data/`.

---

## 1. المشكلة التي نحلها
في أغلب البرامج الصغيرة: جدول `items` فيه عمود `quantity` يُحدَّث عند كل بيع/شراء. النتائج المعروفة:
- لا أحد يعرف **لماذا** الرصيد 37 وليس 40 (لا تاريخ).
- التعديل اليدوي سهل → تلاعب أو أخطاء غير قابلة للتتبع.
- Race conditions عند جهازين.
- تاريخ الانتهاء على مستوى الصنف → خطأ (كل دفعة لها تاريخها).
- الأرباح محسوبة بسعر شراء "حالي" لا بتكلفة الوحدة المباعة فعلاً.

## 2. النمط 1 — سجل حركات المخزون غير القابل للتعديل (Immutable Stock Ledger)

### المبدأ
> **الرصيد لا يُخزَّن؛ يُشتق.** كل تغيير = صف جديد. لا UPDATE ولا DELETE. [1][2]

### البنية
```
stock_movements (append-only)
  id, tenant_id, item_id, lot_id, location_id,
  qty_delta        INTEGER  -- ± بأصغر وحدة بيع (SSU)
  unit_cost_minor  BIGINT   -- تكلفة الوحدة بأصغر وحدة نقدية
  movement_type    ENUM(purchase_receipt, sale, sale_return, purchase_return,
                        transfer_out, transfer_in, adjustment_gain, adjustment_loss,
                        expiry_writeoff, opening_balance)
  reference_type, reference_id   -- الفاتورة/الجرد المصدر
  posted_at, posted_by, reason
```
- `on_hand(item, lot, location) = SUM(qty_delta)`.
- للأداء: جدول `stock_balances` **مشتق** (Materialized/Projection) يُحدَّث بـ Trigger أو في نفس الـ Transaction، وقابل لإعادة البناء من الـ Ledger في أي وقت (ERPNext تفعل الشيء نفسه بـ `Bin`). [3]
- **قيد قاعدة البيانات:** Trigger يمنع UPDATE/DELETE على `stock_movements` (PostgreSQL `RAISE EXCEPTION`). التصحيح = حركة عكسية جديدة.
- **منع السالب:** قبل إدراج حركة سالبة، التحقق أن الرصيد الناتج ≥ 0 داخل Transaction مع قفل الصف (`SELECT ... FOR UPDATE` على `stock_balances`) — قابل للتعطيل بسياسة (Policy) للحالات الاستثنائية مع تسجيل.

### الفوائد
تتبع كامل · جرد موثوق · تقرير "حركة صنف" مجاني · لا تلاعب · مزامنة أسهل لاحقاً (الأحداث قابلة للإعادة).

## 3. النمط 2 — الدفعات (Lots) + FEFO

### Lot
```
lots
  id, tenant_id, item_id, lot_number (nullable إن لم يُعرف), 
  expiry_date DATE, alert_date DATE (محسوب), 
  unit_cost_minor BIGINT, supplier_id, source_type ENUM(official, parallel),
  received_at, purchase_line_id
```
- **كل استلام = Lot جديد** حتى لو نفس lot_number (سعر مختلف → سطر مختلف). هذا يحل مشكلة منصور.
- `alert_date = expiry_date − alert_days` (افتراضي 90 يوم؛ قابل للتهيئة لكل صنف/فئة).
- Odoo تضيف `removal_date` و `best_before` — نعتمد `expiry_date` + `alert_date` الآن، والباقي اختياري. [4]

### FEFO Allocation Algorithm (عند البيع)
```
input: item_id, location_id, qty_needed (SSU)
lots ← SELECT lot_id, on_hand FROM stock_balances
        WHERE item_id=? AND location_id=? AND on_hand>0 AND expiry_date > today
        ORDER BY expiry_date ASC, received_at ASC
for lot in lots:
    take = min(qty_needed, lot.on_hand)
    emit movement(lot, -take, unit_cost=lot.unit_cost)
    qty_needed -= take
    if qty_needed == 0: break
if qty_needed > 0: raise InsufficientStock
```
- المنتهي **لا يُعرض** للبيع (قيد قاعدة بيانات + واجهة).
- **تجاوز يدوي** (اختيار دفعة معينة) بصلاحية `inventory.override_fefo` + سبب مسجّل.
- سطر الفاتورة يحفظ `lot_id` و `unit_cost_minor` → **ربح كل سطر دقيق** (Specific Identification). [5]

## 4. النمط 3 — هرمية الوحدات (Units of Measure)

```
item_units
  item_id, unit_name (علبة/شريط/حبة), factor_to_ssu INTEGER, 
  is_base BOOLEAN, barcode (nullable), sell_price_minor, is_default_sale_unit
```
- **المخزون دائماً بالـ SSU** (أصغر وحدة بيع = `factor=1`).
- علبة = 30 حبة (factor 30)، شريط = 10 (factor 10)، حبة = 1.
- البيع بأي وحدة → يُحوَّل إلى SSU قبل الحركة.
- كل وحدة قد يكون لها باركود خاص (GS1 packaging hierarchy). [6]
- السعر لكل وحدة مستقل (سعر الحبة ليس بالضرورة سعر العلبة ÷ 30).

## 5. النمط 4 — القيد المزدوج غير القابل للتعديل (Immutable Double-Entry)

### المبدأ
> كل حدث مالي = قيد (Journal Entry) له سطران أو أكثر؛ **Σ مدين = Σ دائن**. القيود لا تُعدّل؛ الخطأ يُعكس بقيد جديد. [7][8]

### البنية (مستوحاة من Square Books)
```
accounts (دليل الحسابات)
  id, tenant_id, code, name_ar, type ENUM(asset, liability, equity, revenue, expense), parent_id

journal_entries (append-only)
  id, tenant_id, entry_date, description, reference_type, reference_id, 
  posted_at, posted_by, reversal_of_entry_id (nullable)

journal_lines (append-only)
  id, entry_id, account_id, debit_minor BIGINT, credit_minor BIGINT, 
  currency_code, fx_rate NUMERIC(18,8), amount_base_minor BIGINT
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0))
```
- **قيد تحقق على مستوى القيد:** Trigger/Deferred constraint: `SUM(debit) = SUM(credit)` لكل `entry_id`.
- **أرصدة الحسابات مشتقة** (projection) قابلة لإعادة البناء.

### القيود التلقائية (أمثلة)
| العملية | مدين | دائن |
|---|---|---|
| **بيع نقدي** 1000 (تكلفة 700) | الصندوق 1000 · تكلفة البضاعة المباعة 700 | المبيعات 1000 · المخزون 700 |
| **بيع آجل** | ذمم العملاء | المبيعات (+ COGS/المخزون) |
| **تحصيل من عميل** | الصندوق | ذمم العملاء |
| **شراء آجل** 5000 | المخزون 5000 | ذمم الموردين 5000 |
| **سداد مورد** | ذمم الموردين | الصندوق/البنك |
| **مرتجع بيع** | المبيعات المرتجعة · المخزون | الصندوق/ذمم · COGS |
| **مصروف** (كهرباء) | مصروفات | الصندوق |
| **عجز جرد** | خسائر الجرد | المخزون |
| **زيادة جرد** | المخزون | أرباح/تسويات الجرد |
| **إتلاف منتهي** | خسائر انتهاء الصلاحية | المخزون |
| **فرق عملة** | خسارة/ربح فروق عملة | الحساب المقابل |

### تقييم المخزون
- نستخدم **تكلفة الدفعة الفعلية (Specific Identification)** لأننا نتتبع الدفعات — الأدق للصيدلية. متوافق مع IFRS (الذي يمنع LIFO). [9]
- تقرير "متوسط التكلفة المرجح" يُشتق للمقارنة.

## 6. النمط 5 — ترحيل المستندات (Document Posting Lifecycle)

```
Draft ──► Posted ──► (Reversed | Returned)
  ▲ قابل للتعديل     ▲ غير قابل للتعديل نهائياً
```
- **Draft:** الفاتورة قيد الإدخال؛ تُحفظ محلياً (استئناف بعد انقطاع كهرباء).
- **Posted:** تُنشأ حركات المخزون والقيود المحاسبية **في Transaction واحدة** (Atomic). بعدها: لا تعديل/حذف (قيد DB).
- **التصحيح:** مرتجع (Return) أو عكس كامل (Reversal) ينشئ مستنداً جديداً يشير للأصل. يتطلب صلاحية `documents.reverse` (المسؤول فقط — طلب منصور).
- **Idempotency key** لكل مستند لمنع الترحيل المزدوج (مهم للمزامنة لاحقاً).

## 7. النمط 6 — تخزين الأموال
- `BIGINT amount_minor` + `currency_code CHAR(3)` (مثل Stripe). الريال اليمني بلا كسور عملياً → minor = ريال؛ SAR/USD → هللة/سنت. نعتمد `minor_units` لكل عملة من ISO 4217.
- أسعار الصرف `NUMERIC(18,8)`؛ التقريب **Banker's rounding** أو Half-Up موحد ومُوثّق؛ التقريب يحدث مرة واحدة عند الترحيل ويُحفظ الناتج.

## 8. النمط 7 — سجل التدقيق (Audit Trail)
```
audit_log (append-only)
  id, tenant_id, actor_user_id, action, entity_type, entity_id, 
  before JSONB, after JSONB, at, ip/device_id
```
- لكل تعديل على بيانات قابلة للتعديل (الأصناف، الأسعار، المستخدمين، الإعدادات).
- المستندات المرحّلة والـ Ledgers **لا تحتاج before/after** لأنها لا تتغير — الـ Ledger نفسه هو السجل.

## 9. ما يترتب على ذلك في الكود
- Aggregate `SalesInvoice.post()` يُصدر Domain Events: `StockDeducted`, `JournalEntryPosted`, `InvoicePosted` → معالجات في Inventory و Accounting **داخل نفس Transaction** (Modular Monolith يسمح بذلك عبر Unit of Work).
- Repositories للـ Ledger لها دالة `append()` فقط — لا `update()`/`delete()` في الواجهة أصلاً.

## المصادر
1. Plansmith — Inventory DB design, on-hand is derived: https://plansmith.io/blog/inventory-management-system-database-design
2. Modern Treasury — Enforcing immutability in double-entry ledger: https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger
3. Frappe/ERPNext Stock Ledger & Bin concept: https://frappehealth.com/docs/v13/user/manual/en/healthcare/setup_pharmacy
4. Odoo FEFO & lot dates: https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html
5. NetSuite FEFO lot assignments: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_161009052865.html
6. GS1 packaging hierarchy & DataMatrix: https://www.gs1.org/docs/healthcare/MC07_GS1_Datamatrix.pdf
7. Square — Books immutable double-entry DB: https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/
8. Double-entry for programmers: https://www.balanced.software/double-entry-bookkeeping-for-programmers/ ; https://scaledojo.dev/blogs/double-entry-ledger-design-the-500-year-old-system-that-powers-banking
9. IFRS IAS 2 Inventories (LIFO prohibited): https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/
