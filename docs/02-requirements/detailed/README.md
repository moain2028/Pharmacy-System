# المتطلبات التفصيلية (Detailed Requirements) — "حرف حرف"

> نُتجت في Session #3 بواسطة 6 وكلاء متخصصين بالتوازي (Opus 5.5 / Fable 5.1 / GPT-5.5) بعد بحث في: WHO TRS 1025 Annex 7 (GSDP)، GS1 Healthcare، قرار وزاري يمني 120/9 لسنة 2019 (تسعير الأدوية)، أنظمة قائمة (ERPNext، iVendNext، EloERP، داتا سوفت، يمن سوفت)، ومشاريع GitHub مفتوحة. ثم مراجعة تقاطعية مستقلة (GPT-5.5) لكشف التعارضات.
> **ترقيم المتطلبات هنا يبدأ من 101 داخل كل بادئة** ليُميَّز عن SRS الأساسي (001–0xx). القاموس الموحّد في `07-CROSS-REVIEW-CONFLICTS.md §4` **ملزم** لكل مطوّر/وكيل.

| # | الملف | النطاق | المتطلبات |
|---|---|---|---|
| 01 | `01-CATALOG-UNITS-PRICING-CURRENCY.md` | بطاقة الصنف، الوحدات المرنة (Flexible UOM)، قوائم الأسعار، السعر الرسمي، العروض، الخصومات، العملات/أسعار الصرف، الضريبة | FR-CAT-1xx, FR-PRC-1xx, FR-CUR-1xx |
| 02 | `02-INVENTORY-LOTS-EXPIRY-STOCKTAKE.md` | دورة حياة الدفعة، FEFO، الانتهاء المتدرج، Recall/Quarantine، GS1، بونص، تسويات، إعادة طلب، جرد، مواقع، تحويلات، تقييم IAS 2، أرصدة افتتاحية | FR-INV-1xx, FR-LOT-1xx, FR-STK-1xx |
| 03 | `03-SALES-POS-CUSTOMERS-SHIFTS.md` | شاشة البيع (لوحة مفاتيح أولاً)، تحصيل متعدد العملات، مرتجعات/عكس، عملاء/آجل/حد ائتمان، ورديات X/Z | FR-SAL-1xx, FR-CUS-1xx, FR-SHF-1xx |
| 04 | `04-PURCHASING-SUPPLIERS-CASH-EXPENSES.md` | طلب/أمر شراء، GRN بالدفعات، فاتورة مورد ومطابقة، landed cost، مرتجع مورد، سداد وتخصيص، أعمار ديون، صناديق متعددة العملات، مصروفات، PostingRules | FR-PUR-1xx, FR-SUP-1xx, FR-CSH-1xx, FR-EXP-1xx |
| 05 | `05-REPORTS-PRINT-IO-BACKUP-USERS-SYSTEM.md` | محرك التقارير والكتالوج، القوائم المالية، الطباعة والقوالب، استيراد/تصدير، النسخ الاحتياطي بالأجيال، صلاحيات دقيقة، تدقيق، معالج الإعداد، i18n | FR-RPT-1xx, FR-PRN-1xx, FR-IO-1xx, FR-BKP-1xx, FR-IAM-1xx, FR-SYS-1xx |
| 06 | `06-GAP-REVIEW-EDGE-CASES-PRIORITIES.md` | ما يُنسى عادةً (60+)، 25 حالة حدّية للاختبار، نقد قرارات المالك + ضوابط، **MVP الحقيقي (15 بنداً)** وما يُؤجَّل، مراجع | GAP |
| 07 | `07-CROSS-REVIEW-CONFLICTS.md` | 20 تعارضاً مكتشفاً بين الوثائق وقرار كل منها، تكرارات، فجوات بين الوحدات، **القاموس الموحّد (40 اسماً)**، أعلى 15 خطراً تنفيذياً | — |

## قرارات التعارضات (مُعتمدة — انظر DECISIONS-LOG D-026..D-029)
- العملات: `YER_OLD` / `YER_NEW` / `SAR` / `USD` فقط. عملة الأساس من معالج الإعداد وتُقفل بعد أول ترحيل.
- ترتيب الخصومات والتقريب: وفق FR-PRC-117 الموسّع (D-028).
- السعر الرسمي: `official_price_policy` إعدادية، افتراضي `BLOCK_WITH_OVERRIDE` (D-029).
- الفاتورة المعلّقة `HELD` لا تحجز مخزوناً؛ `RESERVED` تحجز بمهلة.
- الدفعة منتهية من بداية يوم `expiry_date` (لا تُباع يوم الانتهاء).
- حالات الدفعة: `AVAILABLE, NEAR_EXPIRY, EXPIRED, QUARANTINED, BLOCKED, RETURNED_TO_SUPPLIER, DESTROYED, DEPLETED`.
- كل كميات SSU: `BIGINT`. تكلفة الدفعة: `lots.total_cost_minor` + `qty_received_ssu` كمصدر حقيقة.
- حالات المستند: `DRAFT, HELD, PENDING_APPROVAL, POSTED, REVERSED, CANCELLED, EXPIRED`.
- الصلاحيات: صيغة `resource.action`.

## كيف تُستخدم
1. المطوّر/الوكيل يقرأ `07` أولاً (القاموس)، ثم وثيقة نطاقه.
2. أي تعارض جديد يُضاف إلى `07` مع قرار، ويُسجَّل في DECISIONS-LOG إن كان قراراً معمارياً.
3. SRS الأساسي (`../SRS.md`) يبقى الملخص الرسمي؛ هذه الوثائق هي التفصيل القابل للتنفيذ.
