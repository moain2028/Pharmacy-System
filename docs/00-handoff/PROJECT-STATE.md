# PROJECT-STATE — الحالة الحالية للمشروع (المصدر الوحيد للحقيقة)

> **آخر تحديث:** 2026-11-03 — نهاية الجلسة #4 (أول دفعة كود للمرحلة 2)
> **من يحدّث هذا الملف:** أي وكيل/مطور في نهاية كل جلسة.
> **قاعدة:** إذا تعارض هذا الملف مع أي ملف آخر، هذا الملف هو المرجع للحالة الحالية.

---

## 1. المرحلة الحالية
| البند | القيمة |
|---|---|
| المرحلة | **Phase 2 — Foundation Code (domain + db + api)** |
| الحالة | قيد التنفيذ |
| نسبة الإنجاز التقديرية للمرحلة | **~55%** — domain مكتمل (كل الوحدات)، db مكتمل، api: Identity/Catalog/Inventory/Sales/Shifts؛ باقي Returns/Customers/Purchasing/Treasury/Reports API + web + desktop |
| هل يوجد كود تطبيق؟ | **نعم** — `packages/domain` (919 اختبار، 99.67%)، `packages/db` (migration 0001 + 35 اختبار قاعدة بيانات)، `apps/api` (47 اختبار E2E) |
| الفرع النشط | `genspark_ai_developer` |
| آخر PR | https://github.com/moain2028/Pharmacy-System/pull/3 (مفتوح — يُحدَّث بنفس الفرع) |

## 2. المهمة التالية بالضبط (Next Action)
> **ابدأ من هنا إذا كنت وكيلاً جديداً.** اقرأ `AGENTS.md` ثم هذا الملف ثم `SESSION-LOG.md` (#4).

**ما تم (Session #4 — PR #3):**
- Monorepo pnpm+Turbo، TS strict، eslint؛ CI workflow في `ci/github/ci.yml` (**يحتاج المالك نقله إلى `.github/workflows/`** لأن توكن التطبيق لا يملك صلاحية workflows).
- `packages/domain` (نقي، بلا I/O): kernel (Result/Money/Currency/Quantity) + fx + pricing/discount + inventory (Lot/FEFO/StockMovement/expiry/bonus) + accounting (CoA/JournalEntry/posting rules) + iam + audit + sales (SalesInvoice/totals/guards/payment/return) + cash (CashMovement/Cashbox/Shift) + purchasing (PurchaseOrder/GoodsReceipt). **919 اختبار، 99.67% statements / 98.06% branches** (العتبات 99/97). أُضيفت: supplier-invoice (مطابقة ثلاثية)، purchase-return، supplier-ledger، posting-rules-treasury.
- `packages/db`: `migrations/0001_foundation.sql` (62 جدولاً، triggers P0001..P0010، RLS FORCE، دور `pharmacore_app`)، runner بالـ checksum، `withTenant()`، 35 اختباراً تُثبت رفض كل مخالفة.
- `apps/api` NestJS/Fastify: Identity (Argon2id، JWT + refresh دوّار مع كشف إعادة الاستخدام، قفل بعد 5 محاولات، صلاحيات `resource.action` + overrides، معالج الإعداد الأولي)، Catalog (أصناف + سلّم وحدات مرن + باركود GS1 + أسعار + سعر رسمي + أسعار صرف)، Inventory (استلام، أرصدة، FEFO preview، حالات الدفعات، تسويات، تحويلات، كاردكس، worklist الانتهاء). **36 اختبار E2E** على PostgreSQL حقيقي.

**المهمة التالية بالضبط (بالترتيب):**
1. **API Sales Returns + Customers + Receipts** (`apps/api/src/sales/returns.service.ts`, `customers/*`): استخدم domain `SalesReturn.create(req, {defaultReturnWindowDays})` → `post()` → `postingIntent()`؛ ابنِ `PostedInvoiceSnapshot` من `sales_invoices/lines/sale_line_lots/invoice_payments` (returnedQtySsu من `sales_return_lines` المرحّلة)؛ حركات `SALE_RETURN` موجبة على اللوط الأصلي؛ القيد `salesReturnPosted` (refunds كـ PaymentPart، restock = lotCosts)؛ الاسترداد النقدي = `cash_movements` kind `SALE_REFUND` (سالب). المقبوضات: `party_payments` (party_type CUSTOMER) + `customerPaymentPosted` (arSettledBase/depositBase) + `CUSTOMER_PAYMENT` cash movement.
2. **API Purchasing**: suppliers CRUD، PO (`PurchaseOrder`)، GRN (`GoodsReceipt` → لوطات جديدة + RECEIPT + `goodsReceiptPosted`)، فاتورة مورد (`SupplierInvoice` مع GrnLineRef؛ حسابات ap=2100, grni=2150, priceVariance=5150, tax=1500, direct=1400)، مرتجع شراء (`PurchaseReturn` returnLoss=5250)، مدفوعات الموردين (`allocatePayment` FIFO/PRO_RATA/EXPLICIT + `postSupplierPayment`).
3. **API Treasury/Expenses/Reports**: expenses (`postExpense` بحساب الفئة)، transfers/FX (`postCashTransfer`/`postFxExchange` + حركات مزدوجة بـ pair_id)، opening balances (`postOpeningBalances` balancing=3100)؛ تقارير: ميزان مراجعة، أرباح/خسائر، مبيعات يومية/شهرية، مخزون، صلاحيات، أعمار ذمم (`ageOpenItems`).
4. **API عام**: backup (pg_dump endpoint + جدولة)، استيراد/تصدير CSV/Excel، OpenAPI (`@nestjs/swagger`)، ترجمة الأخطاء ar/en في `http-exception.filter`.
5. **apps/web** (React + Vite + Tailwind، RTL/LTR، i18n، POS بلوحة مفاتيح أولاً، معالج الإعداد) ثم **apps/desktop** (Tauri 2 + PostgreSQL مضمّن كخدمة Windows + مثبّت).
6. ملاحظة ثابت الصلاحية: domain `shift.ts` يستخدم `"shift.reopen"` بينما الكتالوج `shifts.reopen` — وحّدهما عند بناء reopen.

## 3. خارطة المراحل الكلية
| # | المرحلة | الحالة | المخرجات الرئيسية |
|---|---|---|---|
| 0 | تأكيد المتطلبات مع العميل | ⏳ لم تبدأ (بانتظار جلسة مع صاحب الصيدلية) | استبيان مُجاب + SRS موقّع |
| 1 | البحث والتحليل والتصميم | ✅ مكتملة ومعتمدة (D-023..D-031) | docs/01 → docs/10 + `docs/02-requirements/detailed/` (7 وثائق) + فيديو v2 |
| 2 | تأسيس Monorepo + البنية التحتية | ⏳ | apps/api, apps/web, packages/domain, Prisma schema, CI |
| 3 | MVP Modules: Identity → Catalog → Inventory → Sales (POS) | ⏳ | وحدات تعمل + اختبارات |
| 4 | Purchasing → Accounting → Stocktake → Reporting | ⏳ | وحدات تعمل + اختبارات |
| 5 | Licensing + Backup + Desktop (Tauri) + Installer | ⏳ | .exe + ترخيص |
| 6 | UAT مع العميل + تدريب + تسليم | ⏳ | دليل مستخدم + عقد صيانة |
| 7 | الإصدار العام (Multi-tenant SaaS + Sync + Mobile) | ⏳ | باقات |

## 4. القرارات المعتمدة (ملخص — التفاصيل في DECISIONS-LOG و ADRs)
- المنتج **عام Multi-tenant** من اليوم الأول، يُفعَّل للعميل الأول كـ Single-tenant محلي.
- **Modular Monolith + Hexagonal Architecture + DDD**.
- Stack مقترح (بانتظار ADR نهائي): TypeScript end-to-end — NestJS + Prisma + PostgreSQL (خادم) / React + Vite + Tailwind (ويب) / Tauri (ديسكتوب).
- قواعد هندسية غير قابلة للتفاوض: NUMERIC للأموال، Immutable Ledger، Lots + FEFO، لا تعديل بعد الترحيل، قيد مزدوج، Audit Trail، Offline-first.

## 5. الأسئلة المفتوحة (Open Questions)
| # | السؤال | المالك | الحالة |
|---|---|---|---|
| Q1 | هل العميل يبيع بالحبة/الشريط/العلبة؟ (يحدد هرمية الوحدات) | معين → العميل | مفتوح |
| Q2 | هل يحتاج بيع آجل (دين عملاء)؟ | معين → العميل | مفتوح |
| Q3 | عملة واحدة (YER) أم مع SAR/USD؟ | معين → العميل | مفتوح |
| Q4 | عدد المستخدمين/الأجهزة في الصيدلية؟ | معين → العميل | مفتوح |
| Q5 | هل عنده قائمة أصناف جاهزة (Excel/برنامج قديم) للاستيراد؟ | معين → العميل | مفتوح |
| Q6 | طابعة فواتير حرارية موجودة؟ قارئ باركود؟ | معين → العميل | مفتوح |
| Q7 | هل الأدوية "المهرّبة" تُسجل بسعر مختلف لنفس الصنف؟ (ملاحظة منصور) | معين → العميل | مفتوح |
| Q8 | اسم المؤسسة النهائي | الفريق | مفتوح (ميل: وميض تك / WamedX) |
| Q9 | السعر النهائي للعميل الأول | الفريق | مفتوح (مقترح: 300–350$ ملكية أو اشتراك) |

## 6. المخاطر النشطة (أعلى 5 — السجل الكامل في docs/10-business/RISK-REGISTER.md)
1. بناء بدون متطلبات مؤكدة من العميل → افتراضات خاطئة.
2. الرغبة في "إنجاز كل شيء في ليلة" → كود بدون هيكل يناقض هدف المؤسسة.
3. تعدد الآراء بدون مرجع واحد → تضارب.
4. السعر منخفض مقارنة بالجهد → خسارة؛ أو مرتفع → هروب العميل.
5. الكهرباء/الإنترنت غير مستقر في اليمن → يجب Offline-first + نسخ احتياطي.

## 7. روابط سريعة
- المستودع: https://github.com/moain2028/Pharmacy-System
- تحليل محادثات الفريق: `docs/00-handoff/TEAM-CHAT-ANALYSIS.md`
- سجل القرارات: `docs/00-handoff/DECISIONS-LOG.md`
- سجل الجلسات: `docs/00-handoff/SESSION-LOG.md`
