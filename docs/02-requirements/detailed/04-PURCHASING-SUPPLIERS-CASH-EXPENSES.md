# مواصفات متطلبات إضافية — PharmaCore  
## النطاق: المشتريات، الموردون، الذمم الدائنة، المصروفات، الصناديق والبنوك  
**Prefixes:** `FR-PUR` / `FR-SUP` / `FR-CSH` / `FR-EXP`  
**ملاحظات ثابتة:**  
- كل مبلغ يُخزّن كـ `BIGINT` بأصغر وحدة للعملة (`minor unit`) مع حقل عملة مستقل.  
- كل كمية مخزون تُخزّن كعدد صحيح بأصغر وحدة بيع (`SSU`).  
- كل مستند مالي/مخزني له حالات: `Draft → Posted → Reversed`، ولا يُعدّل بعد الترحيل.  
- أي تعديل بعد الترحيل يتم عبر مستند عكسي أو مرتجع أو قيد تسوية.  
- الواجهة تعرض مصطلحات تجارية، بينما محرك القيد المزدوج (`Double-entry`) يعمل داخلياً تلقائياً.

---

## 1. دورة المشتريات والمخزون الوارد — Purchase Cycle

### FR-PUR-101 — اقتراح طلب شراء تلقائي من نقاط إعادة الطلب
- **الصياغة EARS:** عندما يطلب المستخدم إنشاء اقتراح شراء، يجب أن يوفّر النظام قائمة أصناف مقترحة بناءً على `reorder_point_ssu` و`min_stock_ssu` و`max_stock_ssu` والمبيعات التاريخية والدفعات القريبة من الانتهاء.
- **الأولوية:** Must
- **حقول البيانات:**
  - `item_id UUID required`
  - `current_stock_ssu BIGINT required`
  - `reorder_point_ssu BIGINT required`
  - `min_stock_ssu BIGINT optional`
  - `max_stock_ssu BIGINT optional`
  - `avg_daily_sales_ssu NUMERIC(18,6) optional`
  - `suggested_qty_ssu BIGINT required`
  - `preferred_supplier_id UUID optional`
  - `reason TEXT required` مثل: `Below reorder point`, `Fast moving`, `Expiring stock ignored`
- **قواعد العمل والحدود:**
  - لا تُحسب الدفعات المنتهية أو المحجوزة أو المعطلة ضمن المخزون المتاح.
  - الدفعات التي ستنتهي خلال فترة التنبيه الحرجة يمكن استبعادها اختيارياً من الحساب.
  - إذا لم يوجد `max_stock_ssu`، يقترح النظام الكمية للوصول إلى `reorder_point_ssu + avg_daily_sales * lead_time_days`.
- **سلوك الواجهة:**
  - تعرض الشاشة سبب الاقتراح لكل صنف مع إمكانية تعديل الكمية قبل تحويلها إلى طلب شراء.
  - يجب عرض الوحدة الافتراضية للشراء بجانب الكمية، مع التخزين داخلياً بـ SSU.
- **معيار القبول:** إذا كان مخزون صنف = 20 SSU، ونقطة إعادة الطلب = 50 SSU، والحد الأعلى = 100 SSU، يجب أن يقترح النظام شراء 80 SSU مع توضيح السبب.

---

### FR-PUR-102 — إنشاء طلب شراء داخلي Purchase Request
- **الصياغة EARS:** يجب أن يوفّر النظام إنشاء طلب شراء داخلي قابل للمراجعة قبل تحويله إلى أمر شراء.
- **الأولوية:** Must
- **حقول البيانات:**
  - `purchase_request_id UUID required`
  - `request_no TEXT unique required`
  - `request_date DATE required`
  - `requested_by_user_id UUID required`
  - `status ENUM(Draft, Submitted, Cancelled, Converted) required`
  - `notes TEXT optional`
  - `lines[] required`
  - `lines.item_id UUID required`
  - `lines.requested_qty_ssu BIGINT required`
  - `lines.purchase_unit_id UUID optional`
  - `lines.preferred_supplier_id UUID optional`
  - `lines.expected_purchase_price_minor BIGINT optional`
  - `lines.currency_code TEXT optional`
- **قواعد العمل:**
  - لا يرحّل طلب الشراء أي قيد مالي أو مخزني.
  - يمكن تجميع عدة طلبات شراء في أمر شراء واحد حسب المورد.
  - لا يسمح بتحويل سطر ملغى أو بكمية صفر.
- **سلوك الواجهة:**
  - زر “تحويل إلى أمر شراء” يظهر فقط لمن يملك صلاحية `purchase_order.create`.
- **معيار القبول:** عند اعتماد طلب شراء يحوي 3 أصناف لمورد واحد، يستطيع المستخدم تحويله إلى أمر شراء يحتوي نفس الأصناف والكميات دون أثر محاسبي.

---

### FR-PUR-103 — أمر شراء متعدد العملات والوحدات
- **الصياغة EARS:** يجب أن يوفّر النظام إنشاء أمر شراء للمورد بأي عملة مع تثبيت سعر الصرف وتحويل كميات وحدات الشراء إلى SSU داخلياً.
- **الأولوية:** Must
- **حقول البيانات:**
  - `purchase_order_id UUID required`
  - `po_no TEXT unique required`
  - `supplier_id UUID required`
  - `order_date DATE required`
  - `expected_delivery_date DATE optional`
  - `invoice_currency_code TEXT required`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `price_list_type ENUM(Retail, Wholesale, Special, SupplierContract) optional`
  - `status ENUM(Draft, Approved, PartiallyReceived, Closed, Cancelled) required`
  - `lines.item_id UUID required`
  - `lines.purchase_unit_id UUID required`
  - `lines.unit_to_ssu_factor BIGINT required`
  - `lines.ordered_qty_purchase_unit NUMERIC(18,6) required`
  - `lines.ordered_qty_ssu BIGINT required`
  - `lines.unit_price_minor BIGINT required`
  - `lines.line_discount_type ENUM(None, Percent, Amount) required`
  - `lines.line_discount_value BIGINT/NUMERIC required حسب النوع`
  - `lines.expected_bonus_qty_ssu BIGINT default 0`
- **قواعد العمل:**
  - `ordered_qty_ssu` يجب أن ينتج رقماً صحيحاً، وإلا يمنع النظام الحفظ.
  - سعر الصرف في أمر الشراء للعرض والتوقع فقط؛ فاتورة المورد تثبّت سعرها النهائي عند الترحيل.
  - يجب منع اعتماد أمر شراء لمورد موقوف `supplier.status = Blocked`.
- **سلوك الواجهة:**
  - عند تغيير وحدة الشراء، تعرض الشاشة المعامل والتحويل إلى أصغر وحدة بيع.
  - تعرض العملة الأصلية والعملة الأساسية جنباً إلى جنب.
- **معيار القبول:** عند شراء 2 كرتون ومعامل الكرتون = 120 حبة، يجب أن يخزن النظام الكمية 240 SSU.

---

### FR-PUR-104 — اعتماد أمر الشراء حسب صلاحية الخصم والحد المالي
- **الصياغة EARS:** عندما يتجاوز أمر الشراء حداً مالياً أو يحتوي خصماً يدوياً، يجب أن يطلب النظام اعتماد مستخدم يملك الصلاحية المناسبة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `approval_required BOOLEAN required`
  - `approval_reason TEXT optional`
  - `approved_by_user_id UUID optional`
  - `approved_at TIMESTAMP optional`
  - `max_po_amount_minor BIGINT per user optional`
  - `max_supplier_discount_percent NUMERIC(5,2) per user optional`
- **قواعد العمل:**
  - لا يسمح بتحويل أمر شراء غير معتمد إلى استلام إذا كان `approval_required = true`.
  - الخصم على السطر والخصم على الفاتورة يقارنان بصلاحية المستخدم.
- **سلوك الواجهة:**
  - تعرض رسالة واضحة: “يتطلب اعتماداً بسبب تجاوز حد الشراء”.
- **معيار القبول:** إذا كان حد المستخدم 100,000 YER وأنشأ أمر شراء بـ 150,000 YER، يجب أن يبقى الأمر في حالة `Draft` أو `PendingApproval` ولا يسمح بالاستلام.

---

### FR-PUR-105 — استلام بضاعة GRN كدفعات Lot إلزامية
- **الصياغة EARS:** عند استلام بضاعة، يجب أن ينشئ النظام دفعة مخزون مستقلة لكل سطر أو تقسيم سطر مع رقم دفعة وتاريخ انتهاء ومصدر وسعر شراء.
- **الأولوية:** Must
- **حقول البيانات:**
  - `grn_id UUID required`
  - `grn_no TEXT unique required`
  - `supplier_id UUID required`
  - `po_id UUID optional`
  - `received_at TIMESTAMP required`
  - `warehouse_id UUID required`
  - `status ENUM(Draft, Posted, Reversed) required`
  - `lines.item_id UUID required`
  - `lines.lot_no TEXT optional`
  - `lines.expiry_date DATE required for expirable items`
  - `lines.received_qty_ssu BIGINT required`
  - `lines.bonus_qty_ssu BIGINT default 0`
  - `lines.purchase_unit_id UUID required`
  - `lines.unit_price_minor BIGINT required`
  - `lines.source_type ENUM(Official, Parallel, Unknown) required`
  - `lines.supplier_batch_ref TEXT optional`
  - `lines.public_price_minor BIGINT optional`
- **قواعد العمل:**
  - الأصناف القابلة للانتهاء لا تُستلم دون `expiry_date`.
  - `bonus_qty_ssu` تدخل المخزون بتكلفة موزعة حسب سياسة تكلفة البونص.
  - يمنع استلام كمية سالبة؛ المرتجعات لها مستند مستقل.
  - إذا كان الصنف له سعر جمهور رسمي، يجب عرض تحذير عند اختلاف `public_price_minor`.
- **سلوك الواجهة:**
  - يسمح بتقسيم سطر أمر الشراء إلى عدة دفعات بتواريخ انتهاء مختلفة.
  - يجب إظهار تحذير أحمر للانتهاء خلال مدة قصيرة.
- **معيار القبول:** عند استلام 10 علب من نفس الصنف بتاريخي انتهاء مختلفين، يجب أن ينشئ النظام دفعتين منفصلتين قابلتين للصرف FEFO.

---

### FR-PUR-106 — معالجة البونص المجاني من المورد
- **الصياغة EARS:** يجب أن يوفّر النظام تسجيل كميات بونص مجانية في الاستلام والفاتورة وتوزيع التكلفة عليها وفق سياسة محددة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `bonus_qty_ssu BIGINT required default 0`
  - `bonus_cost_policy ENUM(ZeroCost, SpreadCostOverPaidAndBonus) required`
  - `effective_unit_cost_minor BIGINT calculated`
- **قواعد العمل:**
  - سياسة `SpreadCostOverPaidAndBonus`: إجمالي تكلفة السطر بعد الخصم ÷ مجموع الكمية المدفوعة + البونص.
  - سياسة `ZeroCost`: البونص يدخل بتكلفة صفر، ويؤثر على متوسط الربح لاحقاً.
  - السياسة الافتراضية المقترحة: `SpreadCostOverPaidAndBonus` لأنها أدق للمخزون.
- **سلوك الواجهة:**
  - تعرض التكلفة الفعلية لكل SSU بعد احتساب البونص قبل الترحيل.
- **معيار القبول:** إذا اشترى المستخدم 100 حبة بـ 10,000 YER وحصل على 20 حبة بونص، وبالسياسة الموزعة، يجب أن تكون تكلفة الحبة 83.33 YER تقريباً وفق قاعدة التقريب المحددة.

---

### FR-PUR-107 — خصومات المورد على السطر والفاتورة
- **الصياغة EARS:** يجب أن يطبق النظام خصومات المورد بترتيب ثابت: خصم السطر أولاً، ثم خصم الفاتورة النسبي أو المبلغ، ثم المصاريف الإضافية.
- **الأولوية:** Must
- **حقول البيانات:**
  - `line_discount_type ENUM(None, Percent, Amount) required`
  - `line_discount_percent NUMERIC(5,2) optional`
  - `line_discount_amount_minor BIGINT optional`
  - `invoice_discount_type ENUM(None, Percent, Amount) required`
  - `invoice_discount_value BIGINT/NUMERIC optional`
  - `rounding_minor BIGINT required default 0`
- **قواعد العمل:**
  - الخصم المبلغي على السطر لا يتجاوز إجمالي السطر قبل الخصم.
  - خصم الفاتورة المبلغي يوزع على الأسطر حسب صافي قيمة كل سطر.
  - التقريب يتم في آخر خطوة على مستوى الفاتورة، والفروقات تسجل في `PurchaseRounding`.
  - الخصومات لا تقلل كمية المخزون، لكنها تخفض تكلفة الدفعات.
- **سلوك الواجهة:**
  - تعرض قبل/بعد الخصم لكل سطر وصافي الفاتورة.
- **معيار القبول:** إذا كانت الفاتورة 100,000 YER وخصم السطور 10,000 ثم خصم فاتورة 5%، يجب أن يكون صافي الخصم الإضافي 4,500 YER وليس 5,000.

---

### FR-PUR-108 — المصاريف الإضافية Landed Cost وتوزيعها على الدفعات
- **الصياغة EARS:** عند تسجيل مصاريف نقل أو جمارك أو تحميل مرتبطة بالشراء، يجب أن يوزعها النظام على تكلفة الدفعات حسب طريقة توزيع يختارها المستخدم.
- **الأولوية:** Must
- **حقول البيانات:**
  - `landed_cost_id UUID required`
  - `linked_grn_id UUID optional`
  - `linked_supplier_invoice_id UUID optional`
  - `expense_type ENUM(Freight, Customs, Clearance, Loading, Other) required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `allocation_method ENUM(ByValue, ByQty, ByWeight, Manual) required`
  - `allocated_amount_minor BIGINT per lot required`
- **قواعد العمل:**
  - لا يسمح بترحيل landed cost دون ارتباط باستلام أو فاتورة شراء، إلا إذا اختار المستخدم `Manual`.
  - عند وجود دفعات بيعت جزئياً قبل تسجيل المصروف، يوزع الجزء المتعلق بالمباع إلى تكلفة البضاعة المباعة (`COGS Adjustment`) والباقي إلى المخزون.
  - مجموع التوزيع يجب أن يساوي مبلغ المصروف بالضبط بعد معالجة فروقات التقريب.
- **سلوك الواجهة:**
  - تعرض جدول توزيع قابل للمراجعة قبل الترحيل.
- **معيار القبول:** إذا أضيفت أجور نقل 10,000 YER على دفعتين قيمتهما 30,000 و70,000 بطريقة `ByValue`، يجب توزيع 3,000 و7,000 YER.

---

### FR-PUR-109 — فاتورة مورد ومطابقة ثلاثية مبسطة
- **الصياغة EARS:** عند إدخال فاتورة مورد، يجب أن يطابق النظام الفاتورة مع أمر الشراء والاستلام وفق حدود سماحية كمية وسعر.
- **الأولوية:** Must
- **حقول البيانات:**
  - `supplier_invoice_id UUID required`
  - `supplier_invoice_no TEXT required`
  - `supplier_id UUID required`
  - `invoice_date DATE required`
  - `due_date DATE required`
  - `currency_code TEXT required`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `linked_po_id UUID optional`
  - `linked_grn_ids UUID[] optional`
  - `match_status ENUM(Matched, PriceVariance, QtyVariance, OverTolerance, Unmatched) required`
  - `tolerance_qty_percent NUMERIC(5,2) required`
  - `tolerance_price_percent NUMERIC(5,2) required`
- **قواعد العمل:**
  - يمنع ترحيل فاتورة تتجاوز السماحية إلا بصلاحية `purchase.match_override`.
  - يمكن إدخال فاتورة دون أمر شراء، لكن يجب وسمها `Unmatched` وتسجيل سبب.
  - رقم فاتورة المورد يجب أن يكون فريداً لكل مورد لمنع التكرار.
- **سلوك الواجهة:**
  - تظهر المقارنة بثلاثة أعمدة: أمر الشراء، الاستلام، الفاتورة.
- **معيار القبول:** إذا كان أمر الشراء 100 وحدة والاستلام 100 والفاتورة 110 مع سماحية 5%، يجب منع الترحيل أو طلب صلاحية تجاوز.

---

### FR-PUR-110 — تثبيت سعر صرف فاتورة المورد
- **الصياغة EARS:** عندما تُرحّل فاتورة مورد بعملة غير العملة الأساسية، يجب أن يثبت النظام سعر الصرف المستخدم ولا يتأثر بتغير الأسعار لاحقاً.
- **الأولوية:** Must
- **حقول البيانات:**
  - `currency_code TEXT required`
  - `currency_variant TEXT optional` مثل `YER_OLD`, `YER_NEW`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `base_total_minor BIGINT calculated`
  - `foreign_total_minor BIGINT required`
- **قواعد العمل:**
  - لا يسمح بسعر صرف صفر أو سالب.
  - أي سداد لاحق بسعر مختلف يولد فرق عملة محققاً.
  - يتم عرض تحذير إذا كان سعر الصرف يختلف عن آخر سعر مسجل بأكثر من نسبة يحددها النظام.
- **سلوك الواجهة:**
  - زر تبديل سريع للعملة مع إظهار السعر الحالي وآخر تاريخ تحديث.
- **معيار القبول:** إذا رُحّلت فاتورة بـ 100 USD وسعر 530 YER/USD، يجب أن تبقى قيمتها الأساسية 53,000 YER حتى لو أصبح السعر لاحقاً 540.

---

### FR-PUR-111 — مرتجع للمورد وإشعار مدين
- **الصياغة EARS:** عندما يرجع المستخدم بضاعة إلى المورد، يجب أن ينشئ النظام مستند مرتجع يخصم الكمية من دفعات محددة ويولّد إشعاراً مديناً للمورد.
- **الأولوية:** Must
- **حقول البيانات:**
  - `supplier_return_id UUID required`
  - `return_no TEXT unique required`
  - `supplier_id UUID required`
  - `return_date DATE required`
  - `linked_grn_id UUID optional`
  - `linked_supplier_invoice_id UUID optional`
  - `debit_note_no TEXT unique required`
  - `lines.item_id UUID required`
  - `lines.lot_id UUID required`
  - `lines.return_qty_ssu BIGINT required`
  - `lines.reason ENUM(Expired, Damaged, WrongItem, Recall, PriceDispute, Other) required`
  - `lines.unit_cost_minor BIGINT required`
- **قواعد العمل:**
  - لا يسمح بإرجاع كمية أكبر من المتاح في الدفعة.
  - إذا كانت الدفعة بيعت جزئياً، يمكن إرجاع الكمية المتبقية فقط.
  - المرتجع يخفض الذمة الدائنة إذا كانت الفاتورة غير مدفوعة، أو ينشئ رصيداً دائناً للمورد إذا كانت مدفوعة.
- **سلوك الواجهة:**
  - اختيار الدفعة إلزامي، وتُعرض بيانات الانتهاء والمورد وسعر الشراء.
- **معيار القبول:** إذا كانت الدفعة المتاحة 30 SSU وحاول المستخدم إرجاع 40، يجب أن يمنع النظام الحفظ.

---

### FR-PUR-112 — إغلاق أمر الشراء جزئياً أو كلياً
- **الصياغة EARS:** يجب أن يوفّر النظام إغلاق أمر الشراء يدوياً أو آلياً عند استلام وفوترة كامل الكميات.
- **الأولوية:** Should
- **حقول البيانات:**
  - `close_reason TEXT optional`
  - `closed_by_user_id UUID optional`
  - `closed_at TIMESTAMP optional`
  - `remaining_qty_ssu BIGINT calculated`
- **قواعد العمل:**
  - لا يسمح بإغلاق أمر شراء فيه استلام غير مفوتر إلا بتحذير واضح.
  - الإغلاق لا يلغي المستندات المرتبطة السابقة.
- **سلوك الواجهة:**
  - تظهر حالة كل سطر: مطلوب، مستلم، مفوتر، متبقي.
- **معيار القبول:** إذا تم استلام 80 من أصل 100 وقرر المستخدم إغلاق الأمر، يجب أن تبقى الكمية المتبقية 20 غير قابلة للاستلام لاحقاً إلا بإعادة فتح بصلاحية.

---

## 2. الموردون والذمم الدائنة — Suppliers & Accounts Payable

### FR-SUP-101 — بطاقة مورد شاملة
- **الصياغة EARS:** يجب أن يوفّر النظام بطاقة مورد تحتوي بيانات قانونية وتجارية ومالية وشروط الدفع والعملات.
- **الأولوية:** Must
- **حقول البيانات:**
  - `supplier_id UUID required`
  - `supplier_code TEXT unique required`
  - `supplier_name_ar TEXT required`
  - `supplier_name_en TEXT optional`
  - `phone TEXT optional`
  - `whatsapp TEXT optional`
  - `email TEXT optional`
  - `address TEXT optional`
  - `tax_no TEXT optional`
  - `commercial_reg_no TEXT optional`
  - `default_currency_code TEXT required`
  - `payment_terms_id UUID optional`
  - `credit_limit_minor BIGINT optional`
  - `status ENUM(Active, Blocked, Inactive) required`
  - `official_agent_name TEXT optional`
  - `notes TEXT optional`
- **قواعد العمل:**
  - المورد الموقوف لا يسمح بإنشاء أوامر شراء أو فواتير جديدة له.
  - يسمح بوجود نفس الهاتف لأكثر من مورد لكن مع تحذير.
- **سلوك الواجهة:**
  - تبويب للحركات، الفواتير المفتوحة، الدفعات، المرتجعات، كشف الحساب.
- **معيار القبول:** عند تغيير حالة المورد إلى `Blocked`، يجب أن يمنع النظام إنشاء أمر شراء جديد له.

---

### FR-SUP-102 — شروط الدفع وآجال الاستحقاق
- **الصياغة EARS:** يجب أن يحسب النظام تاريخ استحقاق فاتورة المورد تلقائياً بناءً على شروط الدفع.
- **الأولوية:** Must
- **حقول البيانات:**
  - `payment_terms_id UUID required`
  - `name TEXT required`
  - `term_type ENUM(Cash, NetDays, EndOfMonth, Installments) required`
  - `net_days INT optional`
  - `early_payment_discount_percent NUMERIC(5,2) optional`
  - `early_payment_days INT optional`
  - `installments JSONB optional`
- **قواعد العمل:**
  - إذا كانت الشروط `Cash` يكون `due_date = invoice_date`.
  - خصم السداد المبكر لا يطبّق إلا إذا تم السداد خلال `early_payment_days`.
- **سلوك الواجهة:**
  - تعرض تاريخ الاستحقاق المتوقع فور اختيار المورد.
- **معيار القبول:** إذا كانت الشروط Net 30 وتاريخ الفاتورة 2026-01-01، يجب أن يكون الاستحقاق 2026-01-31.

---

### FR-SUP-103 — سداد مورد جزئي ومتعدد الفواتير Allocation
- **الصياغة EARS:** عندما يسدد المستخدم مبلغاً لمورد، يجب أن يسمح النظام بتوزيع السداد على فاتورة واحدة أو عدة فواتير أو ترك جزء كدفعة مقدمة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `supplier_payment_id UUID required`
  - `payment_no TEXT unique required`
  - `supplier_id UUID required`
  - `payment_date DATE required`
  - `paid_amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `payment_method ENUM(Cash, BankTransfer, Cheque, EWallet, Other) required`
  - `cashbox_id UUID optional`
  - `bank_account_id UUID optional`
  - `allocations.invoice_id UUID optional`
  - `allocations.allocated_amount_minor BIGINT required`
  - `unallocated_amount_minor BIGINT calculated`
- **قواعد العمل:**
  - مجموع التوزيعات لا يتجاوز مبلغ السداد.
  - الدفعة غير الموزعة تظهر كرصيد مقدم للمورد.
  - لا يسمح بالسداد من صندوق لا يملك المستخدم صلاحية عليه.
- **سلوك الواجهة:**
  - تعرض الفواتير المفتوحة مرتبة بالأقدمية مع زر “توزيع تلقائي”.
- **معيار القبول:** عند دفع 100,000 YER لمورد عليه فاتورتان 60,000 و80,000، يجب أن يستطيع النظام تخصيص 60,000 للأولى و40,000 للثانية ويبقى 40,000 مفتوحاً.

---

### FR-SUP-104 — خصم نقدي عند السداد المبكر
- **الصياغة EARS:** عندما يتم سداد فاتورة ضمن مدة الخصم النقدي، يجب أن يقترح النظام خصم السداد المبكر ويرحله كمكسب خصم مشتريات.
- **الأولوية:** Should
- **حقول البيانات:**
  - `cash_discount_amount_minor BIGINT calculated`
  - `cash_discount_taken BOOLEAN required`
  - `cash_discount_account_id UUID required`
- **قواعد العمل:**
  - الخصم النقدي لا يغير تكلفة المخزون بعد بيع أو ترحيل الفاتورة؛ يسجل كدخل/تخفيض مصروف حسب السياسة.
  - يجب أن يوافق المستخدم قبل تطبيق الخصم.
- **سلوك الواجهة:**
  - تظهر رسالة: “هذه الفاتورة مؤهلة لخصم سداد مبكر بقيمة …”.
- **معيار القبول:** فاتورة 100,000 YER بشروط 2% خلال 10 أيام، إذا سُددت في اليوم الخامس يجب اقتراح خصم 2,000 YER.

---

### FR-SUP-105 — فروقات العملة عند السداد
- **الصياغة EARS:** عندما تسدد فاتورة بعملة مختلفة أو بسعر صرف مختلف عن سعر الفاتورة، يجب أن يولّد النظام فرق عملة محققاً.
- **الأولوية:** Must
- **حقول البيانات:**
  - `invoice_exchange_rate NUMERIC(18,8) required`
  - `payment_exchange_rate NUMERIC(18,8) required`
  - `realized_fx_gain_loss_minor BIGINT calculated`
  - `fx_account_id UUID required`
- **قواعد العمل:**
  - إذا زادت قيمة الالتزام بالعملة الأساسية عند السداد، يسجل فرق خسارة عملة.
  - إذا نقصت، يسجل فرق ربح عملة.
  - يجب دعم `YER_OLD` و`YER_NEW` كعملتين أو متغير عملة منفصل في كل مستند.
- **سلوك الواجهة:**
  - تعرض فرق العملة قبل الترحيل مع لون أخضر للربح وأحمر للخسارة.
- **معيار القبول:** فاتورة 100 USD بسعر 530 = 53,000 YER، وسدادها بسعر 540 = 54,000 YER، يجب تسجيل خسارة عملة 1,000 YER.

---

### FR-SUP-106 — كشف حساب المورد
- **الصياغة EARS:** يجب أن يوفّر النظام كشف حساب مورد يعرض الفواتير والمدفوعات والمرتجعات والفروقات والأرصدة بعملة المستند والعملة الأساسية.
- **الأولوية:** Must
- **حقول البيانات المعروضة:**
  - `document_date`
  - `document_no`
  - `document_type`
  - `currency_code`
  - `debit_minor`
  - `credit_minor`
  - `balance_minor`
  - `base_debit_minor`
  - `base_credit_minor`
  - `base_balance_minor`
  - `reference`
- **قواعد العمل:**
  - يجب أن يكون الرصيد الافتتاحي للفترة محسوباً من الحركات السابقة.
  - يمكن التصفية حسب عملة محددة أو عرض موحد بالعملة الأساسية.
- **سلوك الواجهة:**
  - زر طباعة A4 وزر تصدير Excel/PDF.
- **معيار القبول:** عند اختيار فترة شهرية، يجب أن يظهر رصيد أول المدة، كل الحركات داخل الفترة، ورصيد آخر المدة مطابقاً لدفتر الأستاذ الداخلي.

---

### FR-SUP-107 — أعمار ديون الموردين والعملاء Aging
- **الصياغة EARS:** يجب أن يوفّر النظام تقرير أعمار الديون للفواتير المفتوحة حسب شرائح زمنية قابلة للتعديل.
- **الأولوية:** Must
- **حقول البيانات:**
  - `as_of_date DATE required`
  - `bucket_1_days INT default 30`
  - `bucket_2_days INT default 60`
  - `bucket_3_days INT default 90`
  - `party_type ENUM(Supplier, Customer) required`
  - `open_amount_minor BIGINT calculated`
  - `days_overdue INT calculated`
- **قواعد العمل:**
  - الفواتير غير المستحقة تظهر في شريحة `Current`.
  - الدفعات المقدمة تظهر كرصيد سالب أو في عمود مستقل حسب خيار التقرير.
- **سلوك الواجهة:**
  - إمكانية النقر على المورد لعرض الفواتير المكونة للرصيد.
- **معيار القبول:** فاتورة مستحقة منذ 45 يوماً يجب أن تظهر في شريحة 31–60.

---

### FR-SUP-108 — تنبيهات الاستحقاق
- **الصياغة EARS:** عندما تقترب فاتورة مورد من تاريخ الاستحقاق، يجب أن يظهر النظام تنبيهاً حسب عدد أيام يحدده المستخدم.
- **الأولوية:** Should
- **حقول البيانات:**
  - `due_alert_days INT required default 3`
  - `alert_status ENUM(New, Seen, Dismissed) required`
  - `related_invoice_id UUID required`
- **قواعد العمل:**
  - لا تظهر تنبيهات للفواتير المسددة بالكامل.
  - لا يحذف التنبيه بل يوسم كمقروء للحفاظ على سجل التدقيق.
- **سلوك الواجهة:**
  - شارة في لوحة التحكم مع عدد فواتير الموردين المستحقة قريباً والمتأخرة.
- **معيار القبول:** إذا كان اليوم 2026-01-28 وفاتورة تستحق 2026-01-31 والتنبيه 3 أيام، يجب أن تظهر في قائمة التنبيهات.

---

### FR-SUP-109 — إدارة الشيكات الصادرة والواردة
- **الصياغة EARS:** يجب أن يوفّر النظام إدارة الشيكات بحالات الإصدار والتحصيل والارتجاع والإلغاء.
- **الأولوية:** Should
- **حقول البيانات:**
  - `cheque_id UUID required`
  - `cheque_no TEXT required`
  - `bank_account_id UUID required`
  - `party_id UUID required`
  - `party_type ENUM(Supplier, Customer, Other) required`
  - `cheque_type ENUM(Issued, Received) required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `issue_date DATE required`
  - `due_date DATE required`
  - `status ENUM(Draft, Issued, Deposited, Cleared, Bounced, Cancelled) required`
  - `bounce_fee_minor BIGINT default 0`
- **قواعد العمل:**
  - الشيك الصادر لا يخفض رصيد البنك فعلياً إلا عند حالة `Cleared`، أو حسب سياسة “اعتبار الشيك دفعاً فورياً”.
  - الشيك المرتجع يعيد فتح الذمة ويولد مصروف رسوم إن وجد.
- **سلوك الواجهة:**
  - تقويم استحقاق الشيكات مع فلاتر حسب البنك والحالة.
- **معيار القبول:** عند تغيير شيك صادر من `Issued` إلى `Cleared`، يجب أن ينشئ النظام حركة بنك وسداد مورد مرتبط.

---

## 3. الصناديق، البنوك، المحافظ والتحويلات — Cash, Bank & Treasury

### FR-CSH-101 — تعريف صناديق متعددة بعدة عملات
- **الصياغة EARS:** يجب أن يوفّر النظام تعريف صناديق نقدية متعددة، لكل صندوق أرصدة منفصلة حسب العملة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `cashbox_id UUID required`
  - `cashbox_code TEXT unique required`
  - `cashbox_name TEXT required`
  - `cashbox_type ENUM(CashierDrawer, MainSafe, PettyCash) required`
  - `allowed_currency_codes TEXT[] required`
  - `responsible_user_id UUID optional`
  - `status ENUM(Active, Inactive) required`
- **قواعد العمل:**
  - لا يسمح بحركة بعملة غير مفعلة للصندوق.
  - يمكن ربط صندوق كاشير بورديات البيع، لكن الخزنة الرئيسية لا ترتبط بوردية افتراضياً.
- **سلوك الواجهة:**
  - تعرض الأرصدة حسب العملة، وليس مجموعاً واحداً مضللاً.
- **معيار القبول:** صندوق يسمح بـ YER وSAR فقط؛ عند محاولة الدفع بـ USD يجب أن يمنع النظام العملية.

---

### FR-CSH-102 — حركات صندوق Append-only
- **الصياغة EARS:** عندما تُرحّل أي حركة صندوق، يجب أن يسجل النظام حركة نقدية غير قابلة للتعديل مرتبطة بمستند المصدر.
- **الأولوية:** Must
- **حقول البيانات:**
  - `cash_movement_id UUID required`
  - `cashbox_id UUID required`
  - `movement_date TIMESTAMP required`
  - `direction ENUM(In, Out) required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `source_document_type TEXT required`
  - `source_document_id UUID required`
  - `description TEXT optional`
  - `created_by_user_id UUID required`
- **قواعد العمل:**
  - لا تعديل ولا حذف للحركة؛ التصحيح بحركة عكسية.
  - يمنع الرصيد السالب إذا كانت سياسة الصندوق `disallow_negative_cash = true`.
- **سلوك الواجهة:**
  - أي حركة ملغاة تظهر مشطوبة مع الحركة العكسية، لا تختفي من الكشف.
- **معيار القبول:** بعد ترحيل سند صرف، لا يجب أن يظهر زر تعديل، بل زر “عكس الحركة” فقط لمن يملك الصلاحية.

---

### FR-CSH-103 — تحويل بين صناديق
- **الصياغة EARS:** يجب أن يوفّر النظام تحويل نقدي بين صندوقين مع تسجيل خروج من المصدر ودخول إلى الوجهة برقم تحويل واحد.
- **الأولوية:** Must
- **حقول البيانات:**
  - `cash_transfer_id UUID required`
  - `transfer_no TEXT unique required`
  - `from_cashbox_id UUID required`
  - `to_cashbox_id UUID required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `transfer_date TIMESTAMP required`
  - `status ENUM(Draft, Posted, Reversed) required`
- **قواعد العمل:**
  - يمنع التحويل إلى نفس الصندوق.
  - يجب أن تدعم الوجهة نفس العملة.
  - التحويل لا يحقق ربحاً أو خسارة عملة لأنه بنفس العملة؛ التحويل بين عملتين يجب أن يكون “صرف عملة” مستقل.
- **سلوك الواجهة:**
  - تعرض رصيد الصندوق المصدر قبل وبعد التحويل.
- **معيار القبول:** تحويل 50,000 YER من صندوق الكاشير إلى الخزنة يجب أن يخفض الأول ويزيد الثاني بنفس المبلغ.

---

### FR-CSH-104 — صرف عملة بين صناديق أو خزنة
- **الصياغة EARS:** عندما يبدل المستخدم عملة بأخرى، يجب أن يسجل النظام خروج عملة ودخول عملة أخرى بسعر صرف وفروقات واضحة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `currency_exchange_id UUID required`
  - `from_currency_code TEXT required`
  - `from_amount_minor BIGINT required`
  - `to_currency_code TEXT required`
  - `to_amount_minor BIGINT required`
  - `exchange_rate NUMERIC(18,8) required`
  - `cashbox_id UUID required`
  - `fx_gain_loss_minor BIGINT calculated optional`
- **قواعد العمل:**
  - لا يسمح بصرف بين العملة نفسها.
  - يجب دعم صرف `YER_OLD` إلى `YER_NEW` بسعر مستقل.
  - إذا كانت العملية مجرد تبديل نقدي داخلي بالسعر السوقي، تسجل فروقات الصرف عند تحققها حسب السياسة.
- **سلوك الواجهة:**
  - تعرض آلة حاسبة مبسطة: أعطيت / استلمت / السعر.
- **معيار القبول:** عند صرف 100 SAR إلى YER بسعر 140، يجب تسجيل خروج 100 SAR ودخول 14,000 YER.

---

### FR-CSH-105 — الحسابات البنكية
- **الصياغة EARS:** يجب أن يوفّر النظام تعريف حسابات بنكية بعملة محددة وربطها بالإيداعات والسحوبات والتحويلات.
- **الأولوية:** Must
- **حقول البيانات:**
  - `bank_account_id UUID required`
  - `bank_name TEXT required`
  - `account_name TEXT required`
  - `account_no TEXT optional`
  - `iban TEXT optional`
  - `currency_code TEXT required`
  - `gl_account_id UUID required`
  - `status ENUM(Active, Inactive) required`
- **قواعد العمل:**
  - الحساب البنكي يكون بعملة واحدة افتراضياً؛ الحساب متعدد العملات يحتاج تعريف حسابات منفصلة.
  - لا يسمح بحركة على حساب بنكي غير نشط.
- **سلوك الواجهة:**
  - تظهر شاشة كشف بنك مع فلاتر وعمود رصيد جاري.
- **معيار القبول:** عند تعطيل حساب بنكي، يجب ألا يظهر في قوائم السداد أو الإيداع الجديدة.

---

### FR-CSH-106 — إيداع وسحب بنكي
- **الصياغة EARS:** يجب أن يوفّر النظام إيداع نقد من صندوق إلى بنك وسحب نقد من بنك إلى صندوق مع أثر مزدوج على الأرصدة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `bank_cash_txn_id UUID required`
  - `txn_type ENUM(Deposit, Withdrawal) required`
  - `cashbox_id UUID required`
  - `bank_account_id UUID required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `txn_date TIMESTAMP required`
  - `bank_fee_minor BIGINT default 0`
- **قواعد العمل:**
  - يجب أن تتطابق عملة الصندوق والحساب البنكي للحركة؛ غير ذلك يستخدم مستند صرف عملة.
  - الرسوم البنكية تسجل كمصروف بنكي منفصل.
- **سلوك الواجهة:**
  - تعرض حقلاً اختيارياً للرسوم وسببها.
- **معيار القبول:** إيداع 200,000 YER من الخزنة إلى البنك يجب أن ينقص الخزنة ويزيد البنك، وإذا وجدت رسوم 500 تسجل كمصروف.

---

### FR-CSH-107 — المحافظ الإلكترونية كحسابات مالية
- **الصياغة EARS:** يجب أن يوفّر النظام تعريف المحافظ الإلكترونية كحسابات مالية تقبل القبض والصرف والتحويل.
- **الأولوية:** Should
- **حقول البيانات:**
  - `wallet_id UUID required`
  - `provider_name TEXT required`
  - `wallet_no TEXT required`
  - `currency_code TEXT required`
  - `linked_gl_account_id UUID required`
  - `status ENUM(Active, Inactive) required`
- **قواعد العمل:**
  - رسوم التحويل أو السحب من المحفظة يجب أن تسجل كمصروف.
  - لا تعامل المحفظة كصندوق نقدي في عدّ الكاش الفعلي.
- **سلوك الواجهة:**
  - تظهر المحافظ ضمن طرق الدفع مع أيقونة مختلفة عن البنك والصندوق.
- **معيار القبول:** عند دفع فاتورة مورد من محفظة إلكترونية، يجب أن ينخفض رصيد المحفظة ويغلق جزء من ذمة المورد.

---

### FR-CSH-108 — رأس المال ومسحوبات المالك
- **الصياغة EARS:** يجب أن يوفّر النظام تسجيل إيداع رأس مال ومسحوبات المالك من الصندوق أو البنك دون تمريرها كمبيعات أو مصروفات تشغيلية.
- **الأولوية:** Must
- **حقول البيانات:**
  - `owner_txn_id UUID required`
  - `txn_type ENUM(CapitalInjection, OwnerWithdrawal) required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `source_account_type ENUM(Cashbox, Bank, Wallet) required`
  - `source_account_id UUID required`
  - `owner_name TEXT optional`
  - `notes TEXT optional`
- **قواعد العمل:**
  - رأس المال يزيد النقدية وحقوق الملكية.
  - مسحوبات المالك تنقص النقدية وحقوق الملكية ولا تظهر ضمن مصروفات الربح والخسارة.
- **سلوك الواجهة:**
  - تستخدم عبارات تجارية: “إيداع من المالك” و“سحب للمالك”.
- **معيار القبول:** عند تسجيل سحب مالك 20,000 YER من الخزنة، يجب أن ينقص رصيد الخزنة ولا يظهر في تقرير المصروفات.

---

## 4. المصروفات — Expenses

### FR-EXP-101 — شجرة فئات مصروفات قابلة للتعديل
- **الصياغة EARS:** يجب أن يوفّر النظام شجرة فئات مصروفات قابلة للإضافة والتعديل والتعطيل دون حذف الحركات السابقة.
- **الأولوية:** Must
- **حقول البيانات:**
  - `expense_category_id UUID required`
  - `parent_id UUID optional`
  - `name_ar TEXT required`
  - `name_en TEXT optional`
  - `code TEXT unique optional`
  - `linked_gl_account_id UUID required`
  - `status ENUM(Active, Inactive) required`
- **قواعد العمل:**
  - لا يسمح بحذف فئة عليها حركات؛ يسمح بتعطيلها.
  - يمكن إنشاء فئات مثل: إيجار، كهرباء، رواتب، صيانة، إنترنت، نظافة، رسوم بنكية.
- **سلوك الواجهة:**
  - تعرض الشجرة قابلة للطي والتوسيع مع بحث سريع.
- **معيار القبول:** عند تعطيل فئة “صيانة”، يجب أن تبقى ظاهرة في التقارير القديمة ولا تظهر في إدخال مصروف جديد.

---

### FR-EXP-102 — تسجيل مصروف من صندوق أو بنك أو محفظة
- **الصياغة EARS:** يجب أن يوفّر النظام تسجيل مصروف مع تحديد مصدر الدفع والعملة والفئة والمرفقات.
- **الأولوية:** Must
- **حقول البيانات:**
  - `expense_id UUID required`
  - `expense_no TEXT unique required`
  - `expense_date DATE required`
  - `category_id UUID required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `exchange_rate_to_base NUMERIC(18,8) required`
  - `payment_source_type ENUM(Cashbox, Bank, Wallet) required`
  - `payment_source_id UUID required`
  - `vendor_name TEXT optional`
  - `description TEXT required`
  - `attachment_ids UUID[] optional`
  - `status ENUM(Draft, Posted, Reversed) required`
- **قواعد العمل:**
  - لا يسمح بمبلغ صفر أو سالب.
  - إذا كانت عملة المصروف تختلف عن عملة مصدر الدفع، يجب استخدام مستند صرف أو مصدر يدعم تلك العملة.
- **سلوك الواجهة:**
  - شاشة إدخال سريعة للمصروفات اليومية مع إمكانية التقاط صورة فاتورة.
- **معيار القبول:** عند تسجيل مصروف كهرباء 15,000 YER من صندوق الكاشير، يجب أن ينقص رصيد الصندوق ويرحل المصروف إلى فئة الكهرباء.

---

### FR-EXP-103 — مرفقات صور الفواتير
- **الصياغة EARS:** يجب أن يسمح النظام بإرفاق صورة أو PDF لكل مصروف أو فاتورة شراء مع حفظ مرجع آمن للملف.
- **الأولوية:** Must
- **حقول البيانات:**
  - `attachment_id UUID required`
  - `file_name TEXT required`
  - `file_type TEXT required`
  - `file_size_bytes BIGINT required`
  - `storage_path TEXT required`
  - `sha256_hash TEXT required`
  - `linked_document_type TEXT required`
  - `linked_document_id UUID required`
- **قواعد العمل:**
  - يمنع رفع ملفات تنفيذية.
  - الحد الافتراضي لحجم الملف 10MB قابل للتعديل.
  - لا تحذف المرفقات المرتبطة بمستند مرحّل؛ يمكن وسمها كملغاة بصلاحية.
- **سلوك الواجهة:**
  - معاينة مصغرة للصورة وزر فتح خارجي.
- **معيار القبول:** عند رفع صورة JPG لمصروف، يجب حفظها وإظهارها في شاشة المصروف والطباعة الاختيارية.

---

### FR-EXP-104 — اعتماد المصروفات فوق حد معين
- **الصياغة EARS:** عندما يتجاوز المصروف حد المستخدم أو حد الفئة، يجب أن يطلب النظام اعتماداً قبل الترحيل.
- **الأولوية:** Must
- **حقول البيانات:**
  - `approval_status ENUM(NotRequired, Pending, Approved, Rejected) required`
  - `approval_limit_minor BIGINT per user/category required`
  - `approved_by_user_id UUID optional`
  - `approved_at TIMESTAMP optional`
  - `rejection_reason TEXT optional`
- **قواعد العمل:**
  - لا يسمح للمستخدم باعتماد مصروفه الشخصي إذا كانت سياسة `self_approval_allowed = false`.
  - المصروف المرفوض لا يرحّل ولا يؤثر على الصندوق.
- **سلوك الواجهة:**
  - يظهر شريط حالة “بانتظار الاعتماد” مع تعطيل زر الترحيل.
- **معيار القبول:** إذا كان حد المستخدم 10,000 YER وسجل مصروف 25,000 YER، يجب أن ينتقل إلى `Pending` ولا ينقص الصندوق.

---

### FR-EXP-105 — المصروفات المتكررة
- **الصياغة EARS:** يجب أن يوفّر النظام جدولة مصروفات متكررة مثل الإيجار والإنترنت مع إنشاء مسودات تلقائية.
- **الأولوية:** Should
- **حقول البيانات:**
  - `recurring_expense_id UUID required`
  - `category_id UUID required`
  - `amount_minor BIGINT required`
  - `currency_code TEXT required`
  - `frequency ENUM(Daily, Weekly, Monthly, Quarterly, Yearly) required`
  - `start_date DATE required`
  - `end_date DATE optional`
  - `next_run_date DATE required`
  - `auto_post BOOLEAN default false`
- **قواعد العمل:**
  - الافتراضي إنشاء مسودة لا ترحيل تلقائياً، لتجنب خصم نقدية دون مراجعة.
  - لا ينشئ النظام أكثر من مسودة لنفس الفترة.
- **سلوك الواجهة:**
  - قائمة “مصروفات متوقعة هذا الأسبوع”.
- **معيار القبول:** مصروف إيجار شهري يبدأ 2026-01-01 يجب أن يولد مسودة في بداية كل شهر دون تكرار لنفس الشهر.

---

### FR-EXP-106 — رواتب مبسطة
- **الصياغة EARS:** يجب أن يوفّر النظام، اختيارياً، تسجيل رواتب مبسطة للموظفين كمصروفات مع دفعها من صندوق أو بنك.
- **الأولوية:** Could
- **حقول البيانات:**
  - `payroll_id UUID required`
  - `employee_id UUID required`
  - `period_month DATE required`
  - `basic_salary_minor BIGINT required`
  - `allowances_minor BIGINT default 0`
  - `deductions_minor BIGINT default 0`
  - `net_salary_minor BIGINT calculated`
  - `payment_source_type ENUM(Cashbox, Bank, Wallet) required`
  - `status ENUM(Draft, Posted, Paid, Reversed) required`
- **قواعد العمل:**
  - `net_salary = basic + allowances - deductions`.
  - لا يسمح بصافي راتب سالب.
  - الرواتب تظهر في فئة مصروفات “رواتب” ولا تتطلب نظام موارد بشرية كامل في الإصدار الأول.
- **سلوك الواجهة:**
  - إدخال سريع حسب الموظف والشهر مع منع تكرار راتب نفس الموظف لنفس الشهر.
- **معيار القبول:** موظف راتبه 50,000 وبدلات 5,000 وخصم 2,000 يجب أن يكون صافي راتبه 53,000.

---

## 5. قواعد الترحيل المحاسبي — Posting Rules

> الواجهة لا تعرض “مدين/دائن” للمستخدم العادي، لكن يجب أن ينتج النظام قيوداً مزدوجة متوازنة لكل مستند مرحّل.

### FR-PUR-113 — قاعدة ترحيل استلام قبل الفاتورة
- **الصياغة EARS:** عند ترحيل استلام بضاعة دون فاتورة مورد، يجب أن يرحّل النظام قيمة تقديرية إلى حساب بضاعة مستلمة غير مفوترة.
- **الأولوية:** Must
- **قاعدة الترحيل:**
  - زيادة المخزون بقيمة التكلفة التقديرية.
  - زيادة التزام مؤقت `GRNI - Goods Received Not Invoiced`.
- **مثال رقمي:**
  - استلام 100 حبة، تكلفة تقديرية 100 YER للحبة = 10,000 YER.
  - القيد الداخلي:
    - Inventory +10,000
    - GRNI +10,000
- **معيار القبول:** عند استلام بضاعة دون فاتورة، يجب أن يظهر رصيد في تقرير “استلامات غير مفوترة” بقيمة الاستلام.

---

### FR-PUR-114 — قاعدة ترحيل فاتورة مورد مرتبطة باستلام
- **الصياغة EARS:** عند ترحيل فاتورة مورد مرتبطة باستلام، يجب أن يعكس النظام الالتزام المؤقت ويثبت ذمة المورد والفروقات إن وجدت.
- **الأولوية:** Must
- **قاعدة الترحيل:**
  - تخفيض `GRNI` بقيمة الاستلام المقدرة.
  - زيادة ذمة المورد بالقيمة النهائية.
  - فرق السعر يضاف إلى المخزون إذا الكمية ما زالت موجودة، أو إلى `COGS Adjustment` إذا بيعت.
- **مثال رقمي:**
  - GRN = 10,000، فاتورة نهائية = 10,500.
  - الفرق 500 يوزع على الدفعة إن لم تُبع.
- **معيار القبول:** إذا اختلف سعر الفاتورة عن الاستلام بـ 500 YER، يجب ألا يبقى حساب GRNI مفتوحاً لنفس السطر بعد المطابقة.

---

### FR-PUR-115 — قاعدة ترحيل فاتورة مورد مباشرة بدون GRN
- **الصياغة EARS:** عندما تُرحّل فاتورة شراء مباشرة بدون استلام منفصل، يجب أن ينشئ النظام أثر المخزون والذمة في عملية واحدة إذا كانت الفاتورة تشمل أصنافاً مخزنية.
- **الأولوية:** Should
- **قاعدة الترحيل:**
  - Inventory أو Expense حسب نوع السطر.
  - Supplier Payable بالقيمة النهائية.
- **معيار القبول:** فاتورة مباشرة لصنف مخزني بقيمة 20,000 YER يجب أن تزيد المخزون وتزيد ذمة المورد بالقيمة نفسها بعد الخصومات والمصاريف الموزعة.

---

### FR-SUP-110 — قاعدة ترحيل سداد المورد
- **الصياغة EARS:** عند ترحيل سداد مورد، يجب أن يخفض النظام ذمة المورد ويخفض النقدية أو البنك أو المحفظة ويثبت فرق العملة إن وجد.
- **الأولوية:** Must
- **مثال رقمي:**
  - فاتورة 53,000 YER، سداد نقدي 53,000:
    - Supplier Payable -53,000
    - Cashbox -53,000
  - إذا السداد يعادل 54,000 بسبب سعر صرف:
    - Supplier Payable -53,000
    - Cashbox -54,000
    - FX Loss +1,000
- **معيار القبول:** لا يسمح النظام بترحيل سند سداد لا ينتج قيداً متوازناً.

---

### FR-PUR-116 — قاعدة ترحيل مرتجع المورد
- **الصياغة EARS:** عند ترحيل مرتجع للمورد، يجب أن يخفض النظام المخزون من الدفعة المحددة ويخفض ذمة المورد أو ينشئ رصيداً مستحقاً من المورد.
- **الأولوية:** Must
- **مثال رقمي:**
  - إرجاع 10 حبات بتكلفة 100 = 1,000 YER.
  - Inventory -1,000
  - Supplier Payable -1,000 أو Supplier Debit Balance +1,000 إذا كانت مدفوعة.
- **معيار القبول:** بعد ترحيل المرتجع، يجب أن تنخفض كمية الدفعة المحددة وتظهر قيمة الإشعار المدين في كشف المورد.

---

### FR-EXP-107 — قاعدة ترحيل المصروفات
- **الصياغة EARS:** عند ترحيل مصروف، يجب أن يزيد النظام حساب المصروف المناسب ويخفض مصدر الدفع المحدد.
- **الأولوية:** Must
- **مثال رقمي:**
  - مصروف كهرباء 15,000 من الصندوق:
    - Electricity Expense +15,000
    - Cashbox -15,000
- **معيار القبول:** يجب أن يظهر المصروف في تقرير الربح والخسارة ضمن فئته، وأن ينخفض رصيد الصندوق فور الترحيل.

---

### FR-CSH-109 — قاعدة ترحيل تحويل صندوق/بنك
- **الصياغة EARS:** عند ترحيل تحويل بين صندوق وبنك أو صندوقين، يجب أن يولد النظام حركتين متقابلتين دون أثر على الربح والخسارة.
- **الأولوية:** Must
- **مثال رقمي:**
  - إيداع 100,000 من الخزنة إلى البنك:
    - Bank +100,000
    - Cashbox -100,000
- **معيار القبول:** يجب ألا يظهر التحويل في تقرير المصروفات أو الإيرادات.

---

## 6. الأشياء الصغيرة التي تُنسى عادةً

1. منع تكرار رقم فاتورة المورد لنفس المورد حتى لو اختلفت السنة.  
2. حفظ سعر الصرف في كل سطر أو مستند وعدم الاعتماد على سعر اليوم لاحقاً.  
3. عرض العملة دائماً بجانب أي مبلغ، خصوصاً مع `YER_OLD` و`YER_NEW`.  
4. عدم حذف المورد أو الفئة أو الحساب إذا عليه حركات؛ التعطيل فقط.  
5. طباعة سند قبض/صرف بحجم 80mm وA4.  
6. إظهار اسم المستخدم والوقت في كل سند مرحّل ومطبوع.  
7. دعم مرفقات متعددة للمصروف أو فاتورة المورد.  
8. منع الرصيد السالب للصندوق حسب سياسة قابلة للتفعيل.  
9. إظهار سبب تجاوز 3-way matching في سجل التدقيق.  
10. توزيع فروقات التقريب على أكبر سطر أو حساب تقريب مستقل.  
11. دعم بحث المورد بالاسم، الهاتف، الكود، رقم الفاتورة.  
12. حفظ نسخة PDF من سندات الدفع المهمة اختيارياً.  
13. عدم السماح بتغيير عملة مستند بعد إضافة أسطر إلا بعد تأكيد ومسح الأسعار.  
14. عرض الكميات بوحدة الشراء، لكن التخزين والمقارنة بـ SSU.  
15. تمييز البضاعة الرسمية والموازية في الاستلام والتقارير.  
16. تقرير “استلامات غير مفوترة” مهم جداً لضبط GRNI.  
17. تقرير “فواتير مورد غير مسددة” مع فلتر المستحق والمتأخر.  
18. صلاحية مستقلة لعكس سند مالي مرحّل.  
19. حفظ رقم الشيك وتاريخ استحقاقه في كشف المورد.  
20. عدم احتساب مسحوبات المالك كمصروف تشغيلي.  
21. دعم إدخال مصروف سريع من لوحة الكاشير دون فتح شاشات محاسبية.  
22. إظهار تحذير إذا كان تاريخ انتهاء الدفعة أقرب من الحد الأدنى المقبول للشراء.  
23. تسجيل مصاريف الشحن والجمارك حتى لو دُفعت لمورد مختلف عن مورد البضاعة.  
24. دعم تصدير كشف المورد إلى Excel مع نفس الأرصدة المعروضة.  
25. إظهار الفواتير المدفوعة جزئياً بوضوح لا كمدفوعة أو مفتوحة فقط.

---

## 7. أسئلة لا يمكن حسمها إلا من المالك/العميل

1. **هل تُعامل طبعتا الريال اليمني كعملتين مستقلتين أم كعملة واحدة بمتغير؟**  
   - **الافتراض الافتراضي:** تعريفهما كعملتين منفصلتين `YER_OLD` و`YER_NEW` لتبسيط الأرصدة والتقارير.

2. **ما سياسة تكلفة البونص المجاني؟**  
   - **الافتراض الافتراضي:** توزيع تكلفة السطر على الكمية المدفوعة + البونص (`SpreadCostOverPaidAndBonus`).

3. **هل يمنع النظام الصندوق السالب دائماً؟**  
   - **الافتراض الافتراضي:** نعم للصناديق النقدية، مع إمكانية السماح المؤقت بصلاحية مدير.

4. **هل يعتبر الشيك الصادر سداداً فور إصداره أم عند تحصيله؟**  
   - **الافتراض الافتراضي:** عند التحصيل/المقاصة `Cleared` فقط، والأفضل محاسبياً.

5. **هل يسمح بالترحيل التلقائي للمصروفات المتكررة؟**  
   - **الافتراض الافتراضي:** لا؛ ينشئ النظام مسودة فقط ويحتاج المستخدم لترحيلها.