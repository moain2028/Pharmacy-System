## 1) **تعارضات صريحة** بين الوثائق

| # | التعارض | الوثائق / المتطلبات | الاقتباس المختصر | القرار الموصى به |
|---:|---|---|---|---|
| 1 | **رموز عملات الريال اليمني غير موحّدة** | ملف 01: FR-CUR-101، ملف 03: FR-SAL-137/نموذج البيانات، ملف 04: FR-SUP-105، ملف 05: FR-RPT-117/FR-SYS-101 | FR-CUR-101: `YER-N`, `YER-O`؛ FR-SAL: `YER_N`, `YER_O`؛ FR-SUP-105: `YER_OLD`, `YER_NEW`؛ FR-RPT-117: `YER_OLD`/`YER_NEW` | اعتماد رمزين رسميين فقط: `YER_OLD`, `YER_NEW` في كل الجداول والواجهات وملفات الاستيراد. يمنع استخدام `YER-O/YER-N` أو `YER_O/YER_N` إلا كـ aliases في طبقة ترحيل بيانات. |
| 2 | **عملة الأساس الافتراضية متناقضة** | ملف 01: FR-CUR-102، ملف 03 سؤال 14.1، ملف 05: FR-SYS-101/سؤال 8.2 | ملف 03 يفترض `YER_O`؛ ملف 05 يفترض `YER_NEW`؛ FR-CUR-102 يتركها للمعالج | لا افتراض ثابت في المتطلبات التنفيذية. FR-CUR-102 وFR-SYS-101 هما الحاكمان: تُختار في معالج الإعداد وتُقفل بعد أول ترحيل. |
| 3 | **سياسة تجاوز السعر الرسمي** | ملف 01: FR-PRC-103، ملف 03: FR-SAL-116/117، ملف 05: FR-SYS-102 وسؤال 8.1 | FR-PRC-103: `BLOCK_WITH_OVERRIDE` افتراضي؛ FR-SAL-116: “لا توجد صلاحية تتجاوز”؛ FR-SYS-102: `block|warn|allow`؛ سؤال ملف 05: `warn + PIN` | اعتماد سياسة إعدادية واحدة `official_price_policy = BLOCK | BLOCK_WITH_OVERRIDE | WARN`. الافتراضي المقترح: `BLOCK_WITH_OVERRIDE` مع سبب وصلاحية، مع السماح للمالك بتغييرها إلى `BLOCK`. يجب تعديل FR-SAL-116/117 لإزالة “لا توجد صلاحية تتجاوز” أو جعلها مشروطة بالإعداد. |
| 4 | **ترتيب تطبيق الخصومات غير متطابق** | ملف 01: FR-PRC-117، ملف 02: FR-LOT-108، ملف 03: FR-SAL-118/119 | FR-PRC-117: عرض → خصم مجموعة → خصم سطر → خصم فاتورة → ضريبة → تقريب؛ FR-LOT-108: قرب انتهاء → يدوي/ترويجي → فاتورة؛ FR-SAL: سعر → خصم سطر → خصم فاتورة | اعتماد ترتيب Canonical: السعر المحلول → خصم العرض/قرب الانتهاء → خصم مجموعة العميل → خصم السطر اليدوي → توزيع خصم الفاتورة → الضريبة → تقريب الإجمالي/النقد. يجب تعديل FR-SAL-118 وFR-LOT-108 لتتبعا FR-PRC-117 الموسّع. |
| 5 | **قاعدة تقريب الخصم النسبي متناقضة** | ملف 01: FR-PRC-117، ملف 03: FR-SAL-118، ملف 02: FR-LOT-108 | FR-PRC-117: `round_half_up(amount × bp / 10000)`؛ FR-SAL-118: “يُقرّب لأسفل لصالح الصيدلية”؛ FR-LOT-108: “تقريب بعد كل مرحلة” | اعتماد Half-Up لكل حساب نسبة، وتوزيع بواقي القسمة على أكبر سطر أو سطر محدد. التقريب لأسفل يقتصر على **الباقي النقدي** فقط وفق FR-CUR-110/FR-SAL-141. |
| 6 | **ترحيل الخصومات محاسبياً: صافي أم إجمالي؟** | ملف 01: FR-PRC-120، ملف 03: FR-SAL-122 | FR-PRC-120: `NET` افتراضي أو `GROSS`؛ FR-SAL-122: يفرض GROSS دائماً | اعتماد إعداد `discount_posting = NET | GROSS` كما في FR-PRC-120، مع افتراضي يحدده المالك. تقارير الربحية FR-RPT-107 يجب أن تعمل في الحالتين. |
| 7 | **العرض BUY_X_GET_Y: سطر مجاني بسعر كامل وخصم 100% أم سعر صفر؟** | ملف 01: FR-PRC-114، ملف 03: Edge 12.4 | FR-PRC-114: “بسعره الكامل وخصم 100%”؛ ملف 03: “بسعر صفر وعلَم `is_free=true`” | اعتماد FR-PRC-114: السعر الكامل + خصم 100% بمصدر “عرض”. يمكن وجود `is_free=true` كمعلومة عرضية، لكن لا يكون السعر صفر محاسبياً. |
| 8 | **الفاتورة المعلّقة هل تحجز مخزوناً؟** | ملف 02: FR-INV-110، ملف 03: FR-SAL-123 | FR-INV-110: `parked` invoices تحجز؛ FR-SAL-123: “لا يحجز التعليق أي مخزون” | فصل حالتين: `held` لا يحجز، و`reserved/parked` يحجز بمهلة. تعديل المصطلحات: FR-SAL-123 يستخدم `held`; FR-INV-110 يستخدم `reserved_invoice`. |
| 9 | **تعريف انتهاء الدفعة يوم الانتهاء** | ملف 02: FR-LOT-102/Q4، ملف 03: FR-SAL-111 | FR-LOT-102: `expiry_date ≤ business_date`؛ FR-SAL-111: `expiry_date < today` | اعتماد قاعدة واحدة: الدفعة منتهية من بداية يوم `expiry_date` حسب `business_date`؛ أي `expiry_date <= business_date`، ولا تُباع في يوم الانتهاء. |
| 10 | **أسماء حالة الدفعة متضاربة** | ملف 02: FR-LOT-102، ملف 03: FR-SAL-111/149/150، ملف 01: FR-CAT-105 | FR-LOT-102: `QUARANTINE/BLOCKED/RETURNED/DESTROYED/EXPIRED`; FR-SAL: `damaged/recalled`; FR-CAT: `BLOCKED` للصنف | اعتماد قاموس حالات موحّد للدفعة: `AVAILABLE, NEAR_EXPIRY, EXPIRED, QUARANTINED, BLOCKED, RETURNED_TO_SUPPLIER, DESTROYED, DEPLETED`. وتُعامل `recalled` كسبب `BLOCKED`، و`damaged` كموقع/سبب تسوية لا كحالة أساسية. |
| 11 | **حقل انتهاء الصنف مختلف** | ملف 01: FR-CAT-101، ملف 02: FR-LOT-101 | FR-CAT: `track_expiry`; FR-LOT-101: `item.requires_expiry` | اعتماد `items.track_expiry`. أي استخدام لـ `requires_expiry` يصبح alias فقط في طبقة الاستيراد. |
| 12 | **حجم نوع الكمية: INT أم BIGINT** | ملف 01: اصطلاحات/FR-CAT-117، ملف 02 نموذج البيانات، ملف 03 نموذج البيانات، ملف 04 FR-PUR-101..106 | ملف 01: `ssu_qty BIGINT`; ملف 02: `qty_received_ssu INT`, `qty_delta_ssu INT`; ملف 03: `qty_ssu INT`; ملف 04: `BIGINT` | اعتماد `BIGINT` لكل كميات SSU وحركات المخزون والحجوزات. `INT` غير مقبول بسبب أحجام الاستيراد والعبوات. |
| 13 | **تخزين تكلفة الدفعة: إجمالي الدفعة أم تكلفة وحدة scaled؟** | ملف 01: FR-CAT-125 واصطلاح `unit_cost_scaled`، ملف 02: FR-INV-107، ملف 03: `sale_line_lot.unit_cost_ssu`، ملف 04: FR-PUR-106 | ملف 01: تكلفة SSU scaled؛ ملف 02: “لا يُخزّن سعر الوحدة بل إجمالي التكلفة”؛ ملف 03: `unit_cost_ssu` | اعتماد نموذج FR-INV-107: التخزين الرسمي في `lots.total_cost_minor` و`lots.qty_received_ssu`، وحساب تكلفة الخروج بالتناسب مع ضبط الباقي. يمكن تخزين `unit_cost_scaled_snapshot` في سطور المستند للعرض/الأداء فقط، لا كمصدر حقيقة. |
| 14 | **نموذج الوحدات وأسماء الحقول متضاربة** | ملف 01: FR-CAT-117..123، ملف 02: FR-INV-103، ملف 03: نموذج `sales_invoice_line` | ملف 01: `can_sell/can_purchase/is_default_sale`; ملف 02: `allow_sale/allow_purchase/is_default_display`; ملف 03: `unit_factor` | اعتماد جدول `item_units` الرسمي بحقوله: `factor_to_ssu`, `can_sell`, `can_purchase`, `is_default_sale`, `is_default_purchase`, `is_stock_display`, ولقطة السطر `factor_snapshot`. |
| 15 | **فرادة الباركود ومشاركة الباركود** | ملف 01: FR-CAT-114، ملف 02: FR-LOT-116، ملف 05: الأشياء الصغيرة 7.14 | FR-CAT-114 يسمح `allow_shared_barcode`; FR-LOT-116 يقول `barcode UNIQUE` ويرفض المستخدم لصنف آخر؛ ملف 05 يطلب نافذة اختيار عند التكرار | اعتماد `item_barcodes.normalized_barcode` غير فريد مطلقاً عند تفعيل `allow_shared_barcode`; وإلا فريد جزئياً. عند المسح مع تكرار تظهر نافذة اختيار. |
| 16 | **الكمية في أوامر الشراء تسمح بالكسور بينما المستندات تمنعها** | ملف 01: FR-CAT-118، ملف 04: FR-PUR-103 | FR-CAT-118: “يرفض أي كمية كسرية في أي مستند”؛ FR-PUR-103: `ordered_qty_purchase_unit NUMERIC(18,6)` | اعتماد كميات المستندات كأعداد صحيحة في الوحدة المختارة. إن احتاجت أصناف وزن/سائل مستقبلاً فهي خارج نموذج SSU الحالي وتتطلب قراراً منفصلاً. |
| 17 | **أسماء أسعار الصرف مختلفة** | ملف 01: FR-CUR-103/110، ملف 03: FR-SAL-139/140، ملف 04: FR-PUR-110، ملف 05: FR-RPT-117 | FR-CUR: `buy_rate_scaled/sell_rate_scaled`; FR-SAL: `rate_in/rate_out`; FR-PUR: `exchange_rate_to_base`; FR-RPT: `fx_rates` | اعتماد `exchange_rates.buy_rate_scaled` للاستلام/شراء العملة من العميل، و`sell_rate_scaled` للبيع/صرف الباقي، مع حقول لقطة موحّدة `rate_scaled_snapshot`. |
| 18 | **الصلاحيات بأسماء متضاربة** | ملف 01: `SELL_CONTROLLED`, `EDIT_SALE_PRICE`; ملف 02: `inventory.lot.override_fefo`; ملف 03: `SAL.LOT_OVERRIDE`; ملف 05: FR-IAM-101 | تنسيقات مختلفة: uppercase، dotted، module-prefixed | اعتماد صيغة FR-IAM-101: `resource.action` مثل `sale.edit_price`, `inventory.lot_override_fefo`, `sale.sell_controlled`. كل الأسماء الأخرى aliases مؤقتة في الترحيل. |
| 19 | **حالة المستند بين uppercase/lowercase ومراحل إضافية** | ملف 03: نموذج `sales_invoice`, ملف 04 مقدمة/FR-PUR، ملف 05 FR-SYS-103 | FR-SAL: `draft, held, posted, reversed`; FR-PUR: `Draft → Posted → Reversed`; FR-SYS: `DRAFT-uuid` للمسودات | اعتماد ENUM uppercase داخلياً: `DRAFT, HELD, PENDING_APPROVAL, POSTED, REVERSED, CANCELLED, EXPIRED` مع عرض مترجم. |
| 20 | **السعر الرسمي/المختوم/الجمهور مختلط التسمية** | ملف 01: FR-PRC-103/107، ملف 03: FR-SAL-116، ملف 04: FR-PUR-105، ملف 05: FR-RPT-114 | `official_prices`, `regulated_retail_price`, `public_price_minor`, `printed_public_price` | فصل المصطلحات: `official_prices` = سعر الهيئة، `lots.printed_public_price_minor` = السعر المختوم على الدفعة، و`sale_line.regulated_unit_price_snapshot` = لقطة السقف وقت البيع. |

---

## 2) **تكرارات** يجب توحيدها في مكان واحد

| # | المتطلب المكرر | مذكور في | التوحيد المقترح |
|---:|---|---|---|
| 1 | البحث والتطبيع العربي/الإنجليزي والأرقام | FR-CAT-110، FR-SAL-101، FR-SAL-102، FR-IO-103 | توحيده في خدمة `SearchNormalizationService` ومواصفة واحدة ضمن الكتالوج، وتستهلكها POS والاستيراد. |
| 2 | نموذج الوحدات وSSU ومنع الكسر | FR-CAT-117، FR-CAT-118، FR-INV-103، FR-PUR-103 | توحيده في مواصفة `UOM/SSU Core`؛ كل وحدات البيع/الشراء/الجرد تستخدمها. |
| 3 | لقطة الوحدة في سطور المستندات | FR-CAT-123، FR-SAL نموذج `sales_invoice_line`، FR-PUR-103/105 | تعريف موحّد `DocumentLineUnitSnapshot`. |
| 4 | GS1 DataMatrix / AI(01,10,17,21) | FR-CAT-127، FR-LOT-115، FR-SAL-104، FR-PRN-104 | توحيده في محلل واحد `GS1Parser` تستخدمه الاستلام والبيع والجرد والملصقات. |
| 5 | توليد باركود داخلي وملصقات | FR-CAT-126، FR-LOT-117، FR-PRN-104 | توحيده في وحدة `Barcode & Labeling`. |
| 6 | FEFO وتخصيص الدفعات | FR-LOT-103، FR-SAL-110، FR-PRC-107 | توحيده في خدمة `LotAllocationService`; POS والتسعير يستدعيان نفس التخصيص. |
| 7 | تجاوز FEFO بسبب وصلاحية | FR-LOT-104، FR-SAL-113، FR-SAL-104 | توحيده في سياسة `lot_override` مع أسباب موحّدة. |
| 8 | منع بيع المنتهي/المحجور/المحظور | FR-LOT-105، FR-SAL-111، FR-SAL-149 | توحيده في `SellableLotPolicy`. |
| 9 | بونص المورد يخفض التكلفة | FR-CAT-125، FR-LOT-113، FR-PUR-106، FR-RPT-103 | توحيده في سياسة `bonus_cost_policy`؛ الافتراضي `SPREAD_COST`. |
| 10 | السعر الرسمي والتحقق من تجاوزه | FR-PRC-103، FR-SAL-116، FR-SAL-117، FR-RPT-114، FR-SYS-102 | توحيده في `OfficialPricePolicy`. |
| 11 | ترتيب الخصومات وتوزيع خصم الفاتورة | FR-PRC-116، FR-PRC-117، FR-SAL-118، FR-SAL-119، FR-SAL-121 | توحيده في `SalesCalculationEngine`. |
| 12 | حدود الخصم وPIN المدير | FR-PRC-118، FR-SAL-120، FR-IAM-104، FR-IAM-105 | توحيده في IAM وليس داخل المبيعات فقط. |
| 13 | المرتجع يستخدم لقطة الفاتورة الأصلية | FR-PRC-121، FR-SAL-147، FR-SAL-148، FR-SAL-149 | توحيده في `SalesReturnEngine`. |
| 14 | سعر الصرف المجمّد في المستند | FR-CUR-106، FR-SAL-139، FR-PUR-110، FR-RPT-117 | توحيده في `FxSnapshotPolicy`. |
| 15 | التحصيل متعدد العملات والباقي والتقريب | FR-CUR-110، FR-SAL-137، FR-SAL-141، FR-SAL-142 | توحيده في `TenderEngine`. |
| 16 | أرصدة النقد لكل عملة في الوردية | FR-CUR-111، FR-SHF-103، FR-SHF-107، FR-RPT-106 | توحيده في `ShiftCashLedger`. |
| 17 | تقارير X/Z وإعادة طباعة Z | FR-SHF-106، FR-SHF-110، FR-RPT-106، FR-PRN-106 | توحيده في وحدة `Shift Reports`. |
| 18 | ترقيم المستندات بلا فجوات عند الترحيل | FR-SAL-133، FR-SYS-103 | توحيده في `NumberingSeriesService`. |
| 19 | إعادة الطباعة بوسم COPY وعدّاد | FR-SAL-136، FR-PRN-111 | توحيده في `PrintAuditPolicy`. |
| 20 | السجل append-only والتدقيق | FR-CAT-113، FR-INV-101، FR-CSH-102، FR-IAM-110 | توحيده في إطار `AppendOnly + AuditLog`. |
| 21 | اقتراح الشراء من نقاط إعادة الطلب | FR-INV-104، FR-PUR-101 | توحيده في وحدة `Replenishment`. |
| 22 | أعمار الديون وكشوف العملاء/الموردين | FR-CUS-105/106، FR-SUP-106/107، FR-RPT-105 | توحيده في `PartyLedger & Aging`. |
| 23 | الاستيراد الموحد مع أخطاء الصفوف | FR-CAT-112، FR-INV-109، FR-IO-102، FR-IO-108 | توحيده في `ImportWizard`. |
| 24 | سجل الأدوية المراقبة | FR-CAT-107، FR-SAL-129، FR-RPT-113 | توحيده في `ControlledSubstanceRegister` وجعله Must. |
| 25 | منع حذف الكيانات ذات الحركات | FR-CAT-103، FR-SUP-101، FR-EXP-101، FR-IAM-108 | قاعدة عامة: `deactivate_not_delete` لكل Master Data. |

---

## 3) **فجوات بين الوحدات**

| # | الفجوة | المتطلبات المعنية | الأثر | المطلوب حسمه |
|---:|---|---|---|---|
| 1 | المبيعات تبحث في `scientific_name` و`strength` لكن الكتالوج يعتمد `active_ingredients` و`item_ingredients` ولا يعرّف حقلاً موحداً بهذا الاسم | FR-CAT-109/110، FR-SAL-101/109، FR-IO-103 | نتائج البدائل والبحث قد تختلف بين POS والاستيراد | تعريف `generic_display_name` مشتق أو View موحّد من المواد الفعالة + التركيز + الشكل. |
| 2 | المبيعات تستخدم `min_sell_price` و`min_margin_pct` بينما التسعير يذكر `min_sale_price_minor` و`min_margin_bp` دون مكان تخزين واضح | FR-PRC-109، FR-SAL-116/121 | فشل تحقق البيع تحت التكلفة أو اختلافه | إضافة حقول Canonical في `price_list_items` أو `item_price_policies`. |
| 3 | المبيعات تفترض `non_returnable` و`max_qty_per_rx` في الصنف، لكنها غير معرفة في بطاقة الصنف | FR-SAL-130/150، FR-CAT-101/106/107 | لا يمكن تطبيق قيود المرتجع والوصفة | إضافة `items.non_returnable_policy` و`items.max_qty_per_rx_ssu`. |
| 4 | التقارير الضريبية تطلب ضريبة مدخلات مشتريات، لكن نموذج فاتورة المورد لا يعرّف حقول ضريبة السطر | FR-RPT-112، FR-PUR-109، FR-CUR-115/116 | تقرير TAX-SUMMARY غير قابل للتنفيذ للمشتريات | إضافة `supplier_invoice_lines.tax_category_id`, `tax_rate_bp_snapshot`, `tax_minor`. |
| 5 | landed cost يدعم التوزيع بالوزن، لكن بطاقة الصنف لا تحتوي وزن/حجم | FR-PUR-108، FR-CAT-101 | خيار `ByWeight` غير قابل للتنفيذ | إضافة `item_units.net_weight` أو حذف `ByWeight` من الإصدار الأول. |
| 6 | POS/الورديات لا تربط بوضوح `shift` مع `cashbox_id` رغم وجود صناديق مستقلة | FR-SHF-101..107، FR-CSH-101/102، FR-SAL نموذج `shift` | صعوبة مطابقة تقرير Z مع دفتر الصندوق | إضافة `shift.cashbox_id` و`shift_currency.cashbox_id`. |
| 7 | GRN يستخدم `warehouse_id` بينما المخزون يعتمد `location_id` شجري | FR-PUR-105، FR-STK-101، FR-LOT-101 | الاستلام لا يعرف الموقع/الرف الفعلي ولا صلاحية البيع | استبدال `warehouse_id` بـ `location_id` أو ربط warehouse بموقع جذر. |
| 8 | السعر الرسمي يستورد بالمنطقة لكن النظام لا يعرّف إعداد منطقة الصيدلية المستخدم في البيع | FR-PRC-104، FR-PRC-103، FR-CUR-108، FR-SYS-101 | اختيار سعر رسمي خاطئ بين عدن/صنعاء/غيرها | إضافة `company_settings.official_price_region`. |
| 9 | `agent item code` مطلوب للبحث/استيراد السعر الرسمي لكن غير معرف في `items` | FR-CAT-110، FR-PRC-104، FR-IO-106 | مطابقة قوائم الهيئة ستكون ضعيفة | إضافة `item_supplier_codes` أو `items.agent_item_code`. |
| 10 | التأمين مذكور في العملاء والتقارير دون دورة مطالبة/تحصيل واضحة | FR-CUS-112، FR-RPT-102، FR-SAL doc fields | أرصدة جهة التأمين وتحصيلها غير مكتملة | إضافة نموذج `insurance_claims`, `claim_status`, `claim_payments`. |
| 11 | استيراد أرصدة افتتاحية للذمم مذكور لكن قيود افتتاح AR/AP غير مفصلة | FR-IO-105، FR-RPT-105، FR-RPT-109 | ميزان المراجعة والمركز المالي قد لا يتوازنان | إضافة مستند `opening_party_balance` بترحيل محاسبي واضح. |
| 12 | تقرير PROFIT-BY-SUPPLIER يحتاج ربط مبيعات الدفعة بالمورد الأصلي؛ موجود في `lots.supplier_id` لكن المرتجعات والتحويلات بين الفروع قد تغيّر السياق | FR-RPT-107، FR-LOT-101، FR-STK-107 | أرباح المورد قد تكون ناقصة عند التحويل/الدمج | تثبيت `supplier_id_snapshot` في `sale_line_lots` أو اعتماد lot كمصدر دائم. |
| 13 | الطباعة تطلب السعر الرسمي/السعر المختوم على الملصق دائماً، لكن ليس كل صنف له سعر رسمي | FR-LOT-117، FR-PRN-104، FR-PRC-103 | فشل طباعة ملصقات مستلزمات/تجميل | سياسة عرض: إن لم يوجد official price، اطبع سعر قائمة البيع أو اتركه فارغاً مع تحذير. |
| 14 | مراكز التنبيهات مذكورة للمخزون واللوحة، لكن لا يوجد قاموس موحد لأنواع التنبيه بين الوحدات | FR-INV-111، FR-RPT-115، FR-BKP-109، FR-SUP-108 | تنبيهات متكررة أو غير قابلة للإقرار | إضافة `alerts` موحد لكل الوحدات: inventory, backup, AP, shifts, system. |
| 15 | التقارير تفترض `business_day_start` بينما بعض متطلبات البيع تقول تاريخ الفاتورة هو التاريخ الفعلي | FR-RPT-102، FR-SHF-112، ملف 01 الأشياء الصغيرة 19، ملف 05 الأشياء الصغيرة 16 | اختلاف SAL-DAILY وZ حول اليوم | تعريف `business_date` لكل مستند عند الترحيل بناءً على `business_day_start_hour`. |
| 16 | صلاحية رؤية التكلفة/الربح مطلوبة لكن نماذج التقارير لا تذكر إخفاء الأعمدة حسب الصلاحية | FR-IAM-101، FR-RPT-107، FR-SAL-107 | تسريب تكلفة الشراء للكاشير | فرض `inventory.view_cost` و`report.view_profit` على الأعمدة وليس التقرير فقط. |
| 17 | المشتريات المباشرة بدون GRN Should، لكن المخزون والدفعات يشترطان دفعات عند الاستلام | FR-PUR-115، FR-LOT-101، FR-PUR-105 | مسار شراء مباشر قد يتجاوز lot/expiry | إن كانت الفاتورة تشمل صنفاً مخزونياً يجب إنشاء GRN داخلي ضمن نفس المعاملة. |
| 18 | العينات المجانية في المخزون لا تتكامل مع فاتورة صفر/عينات في البيع | FR-LOT-114، FR-SAL Edge 12.3، FR-PRC-119 | احتمال بيع عينات أو صرفها بمسار خاطئ | اعتماد مستند `sample_dispense` فقط للعينات، وفاتورة صفر للمبيعات الترويجية لا تستخدم دفعات `is_sample=true`. |
| 19 | التحكم في ساعة الجهاز موجود، لكن لا توجد سياسة مزامنة وقت موحّدة في بيئة أجهزة متعددة | FR-SYS-109، FR-INV-101، FR-SAL-132 | تضارب `posted_at` وترقيم وتسلسل في أكثر من جهاز | استخدام وقت قاعدة PostgreSQL كمرجع وحظر الترحيل عند انحراف ساعة العميل. |
| 20 | التراجع عن الاستيراد وحذف منطقي قد يتعارض مع قاعدة append-only للكيانات المستخدمة | FR-IO-109، FR-IAM-110، FR-CAT-103 | حذف منطقي قد يكسر مراجع التقارير | التراجع يسمح فقط للبيانات غير المستخدمة، ويجب أن يسجل `reversed_import_batch_id` لا حذفاً فعلياً. |

---

## 4) **قاموس موحّد مقترح** (Canonical names)

| # | المفهوم | الاسم الرسمي المقترح | ملاحظات ربط بالمتطلبات |
|---:|---|---|---|
| 1 | عملة الريال القديم | `YER_OLD` | بديل لـ `YER-O`, `YER_O`, `YER_OLD` في FR-CUR-101/FR-SAL-137/FR-RPT-117 |
| 2 | عملة الريال الجديد | `YER_NEW` | بديل لـ `YER-N`, `YER_N`, `YER_NEW` |
| 3 | جدول العملات | `currencies` | FR-CUR-101 |
| 4 | جدول أسعار الصرف | `exchange_rates` | FR-CUR-103 |
| 5 | سعر شراء العملة | `buy_rate_scaled` | FR-CUR-103/110 |
| 6 | سعر بيع العملة | `sell_rate_scaled` | FR-CUR-103/108 |
| 7 | لقطة سعر الصرف في المستند | `rate_scaled_snapshot` | FR-CUR-106، FR-SAL-139، FR-PUR-110 |
| 8 | جدول الأصناف | `items` | FR-CAT-101 |
| 9 | كود الصنف | `item_code` | FR-CAT-101 |
| 10 | الاسم التجاري العربي/الإنجليزي | `trade_name_ar`, `trade_name_en` | FR-CAT-101 |
| 11 | حقل انتهاء الصنف | `track_expiry` | يوحّد `requires_expiry` في FR-LOT-101 |
| 12 | شرط الوصفة | `rx_required` ENUM `NONE,RX,RX_RETAIN` | FR-CAT-106، FR-SAL-129 |
| 13 | تصنيف الرقابة | `controlled_class` ENUM `NONE,PSYCHOTROPIC,NARCOTIC,PRECURSOR` | FR-CAT-107 |
| 14 | جدول وحدات الصنف | `item_units` | FR-CAT-117، FR-INV-103 |
| 15 | معامل الوحدة إلى SSU | `factor_to_ssu` | FR-CAT-117 |
| 16 | السماح بالبيع/الشراء | `can_sell`, `can_purchase` | يوحّد `allow_sale/allow_purchase` |
| 17 | الوحدة الافتراضية للبيع/الشراء | `is_default_sale`, `is_default_purchase` | FR-CAT-117 |
| 18 | لقطة معامل الوحدة في السطر | `factor_snapshot` | FR-CAT-123 |
| 19 | جدول الباركودات | `item_barcodes` | FR-CAT-114، FR-LOT-116 |
| 20 | الباركود المطبّع | `normalized_barcode` | يدعم UPC/EAN/GTIN |
| 21 | جدول الدفعات | `lots` | FR-LOT-101 |
| 22 | رقم الدفعة | `lot_number` | بديل لـ `lot_no` |
| 23 | تاريخ الانتهاء | `expiry_date` | FR-LOT-101 |
| 24 | حالة الدفعة اليدوية | `manual_status` | FR-LOT-102 |
| 25 | حالة الدفعة المحسوبة | `effective_status` | FR-LOT-102 |
| 26 | تكلفة الدفعة الإجمالية | `total_cost_minor` | FR-INV-107 |
| 27 | كمية الدفعة الأصلية | `qty_received_ssu` BIGINT | FR-LOT-101 |
| 28 | حركات المخزون | `stock_movements` | FR-INV-101 |
| 29 | أرصدة المخزون | `stock_balances` | FR-INV-101 |
| 30 | المواقع | `locations` | FR-STK-101 |
| 31 | فاتورة البيع | `sales_invoices` | FR-SAL-132 |
| 32 | سطر فاتورة البيع | `sales_invoice_lines` | FR-SAL data model |
| 33 | تخصيص الدفعات في البيع | `sale_line_lots` | FR-SAL-110، FR-LOT-103 |
| 34 | دفعات التحصيل | `invoice_payments` | FR-SAL-137 |
| 35 | السعر الرسمي | `official_prices` | FR-PRC-103 |
| 36 | السعر المختوم على الدفعة | `lots.printed_public_price_minor` | FR-PRC-107 |
| 37 | قوائم الأسعار | `price_lists`, `price_list_items` | FR-PRC-101 |
| 38 | تاريخ الأسعار | `price_history` | FR-PRC-110 |
| 39 | سجل التدقيق | `audit_log` | FR-IAM-110 |
| 40 | سلسلة الترقيم | `numbering_series` | FR-SYS-103 |

---

## 5) **قائمة أعلى 15 خطراً تنفيذياً** مرتبة

| الترتيب | الخطر | المتطلبات المتأثرة | سبب الخطورة | التوصية |
|---:|---|---|---|---|
| 1 | **عدم توحيد العملات والطبعتين YER_OLD/YER_NEW** | FR-CUR-101..114، FR-SAL-137..146، FR-PUR-110، FR-RPT-117 | سيؤدي إلى أرصدة نقدية وتقارير وذمم غير صحيحة | تثبيت قاموس العملات مبكراً ومنع أي رمز غير Canonical في قاعدة البيانات. |
| 2 | **محرك الحسابات والخصومات غير موحّد** | FR-PRC-116..121، FR-SAL-118..122، FR-LOT-108 | اختلاف ريال واحد في كل فاتورة سيفسد Z والربحية والضرائب | بناء `SalesCalculationEngine` باختبارات ذهبية قبل واجهة POS. |
| 3 | **تعارض سياسة السعر الرسمي** | FR-PRC-103، FR-SAL-116/117، FR-SYS-102، FR-RPT-114 | خطر تنظيمي وقانوني مباشر | حسم سياسة المالك في الإعداد، وجعل الكود يطبق سياسة واحدة فقط. |
| 4 | **نموذج تكلفة الدفعات والتقريب عند الخروج** | FR-INV-107، FR-CAT-125، FR-PUR-106، FR-RPT-107/111 | أي خطأ يضرب COGS، الربح، تقييم المخزون | اعتماد `total_cost_minor` + خوارزمية residual واختبارات لكل حالات البونص والبيع الجزئي. |
| 5 | **التزام append-only مع العكس بدلاً من التعديل** | FR-INV-101، FR-CSH-102، FR-IAM-110، FR-SAL-155 | أي UPDATE/DELETE بعد الترحيل يكسر الثقة والتدقيق | فرض قيود PostgreSQL triggers/REVOKE من اليوم الأول. |
| 6 | **FEFO والحجز والتزامن بين كاشيرين** | FR-LOT-103، FR-INV-110، FR-SAL-110، FR-SAL-132 | سباق بيع آخر كمية قد ينتج مخزوناً سالباً | استخدام `SELECT FOR UPDATE` وخدمة تخصيص مركزية داخل transaction. |
| 7 | **ترقيم المستندات بلا فجوات تحت التزامن** | FR-SAL-133، FR-SYS-103 | صعب تقنياً مع أجهزة متعددة وفشل ترحيل | تخصيص الرقم عند `POST` فقط وبقفل صف السلسلة، مع idempotency عبر FR-SAL-132. |
| 8 | **عدم حسم held vs reserved invoices** | FR-INV-110، FR-SAL-123/124/125 | قد يحجز النظام مخزوناً دون علم المستخدم أو يبيعه مرتين | فصل حالتي `HELD` و`RESERVED` في التصميم والواجهة. |
| 9 | **التقارير المالية تعتمد على بيانات غير مسجلة أو غير موحّدة** | FR-RPT-102..117، FR-PUR-109، FR-SAL data model | تقارير الربح/الضريبة/المركز المالي قد تفشل أو تختلف عن القيود | تصميم مخطط التقارير من البداية مع حقول snapshots المطلوبة. |
| 10 | **تكامل POS مع Cashbox/Shift غير مكتمل** | FR-SHF-101..115، FR-CSH-101..109، FR-RPT-106 | Z قد لا يطابق دفتر الصندوق، خصوصاً مع عدة عملات | إضافة `cashbox_id` لكل وردية وحركة دفع نقدي. |
| 11 | **الاستيراد قد يخلق بيانات غير صالحة تاريخياً** | FR-CAT-112، FR-INV-109، FR-IO-102..109 | استيراد أصناف/وحدات/دفعات خاطئة يصعب عكسه بعد البيع | تفعيل dry-run صارم، وقيود قاعدة، ودفعات import قابلة للتتبع. |
| 12 | **تعدد أسماء الحقول والجداول يسبب ازدواج مخطط** | FR-CAT-101، FR-INV-103، FR-SAL models، FR-PUR-105 | فرق التطوير قد تنشئ `lot_no` و`lot_number` معاً أو `warehouse_id/location_id` | اعتماد قاموس Canonical كمرجع معماري إلزامي قبل التطوير. |
| 13 | **الصلاحيات والتجاوزات موزعة بأسماء مختلفة** | FR-IAM-101..105، FR-PRC-118، FR-SAL-120، FR-LOT-104 | مخاطر احتيال وفتح صلاحيات دون قصد | تنفيذ IAM مركزي قبل POS والمخزون. |
| 14 | **GS1 والباركودات المشتركة والأصفار البادئة** | FR-CAT-114/127، FR-LOT-115/116، FR-SAL-103/104، FR-PRN-104 | أخطاء المسح تؤدي لصنف/دفعة خاطئة | بناء مكتبة Barcode/GS1 واحدة مع اختبارات بيانات حقيقية من السوق. |
| 15 | **النسخ الاحتياطي والاستعادة غير المختبرين** | FR-BKP-101..110، FR-SYS-104 | فقدان بيانات الصيدلية خطر وجودي | جعل backup + restore verification جزءاً من الإعداد الأول والتحديثات. |