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
| نسبة الإنجاز التقديرية للمرحلة | **~45%** — domain شبه مكتمل، db مكتمل، api: Identity/Catalog/Inventory؛ باقي Sales/Purchasing/Reports API + web + desktop |
| هل يوجد كود تطبيق؟ | **نعم** — `packages/domain` (747 اختبار، 99.6%)، `packages/db` (migration 0001 + 35 اختبار قاعدة بيانات)، `apps/api` (36 اختبار E2E) |
| الفرع النشط | `genspark_ai_developer` |
| آخر PR | https://github.com/moain2028/Pharmacy-System/pull/3 (مفتوح — يُحدَّث بنفس الفرع) |

## 2. المهمة التالية بالضبط (Next Action)
> **ابدأ من هنا إذا كنت وكيلاً جديداً.** اقرأ `AGENTS.md` ثم هذا الملف ثم `SESSION-LOG.md` (#4).

**ما تم (Session #4 — PR #3):**
- Monorepo pnpm+Turbo، TS strict، eslint؛ CI workflow في `ci/github/ci.yml` (**يحتاج المالك نقله إلى `.github/workflows/`** لأن توكن التطبيق لا يملك صلاحية workflows).
- `packages/domain` (نقي، بلا I/O): kernel (Result/Money/Currency/Quantity) + fx + pricing/discount + inventory (Lot/FEFO/StockMovement/expiry/bonus) + accounting (CoA/JournalEntry/posting rules) + iam + audit + sales (SalesInvoice/totals/guards/payment/return) + cash (CashMovement/Cashbox/Shift) + purchasing (PurchaseOrder/GoodsReceipt). **747 اختبار، 99.6% statements / 98.2% branches** (العتبات 99/97).
- `packages/db`: `migrations/0001_foundation.sql` (62 جدولاً، triggers P0001..P0010، RLS FORCE، دور `pharmacore_app`)، runner بالـ checksum، `withTenant()`، 35 اختباراً تُثبت رفض كل مخالفة.
- `apps/api` NestJS/Fastify: Identity (Argon2id، JWT + refresh دوّار مع كشف إعادة الاستخدام، قفل بعد 5 محاولات، صلاحيات `resource.action` + overrides، معالج الإعداد الأولي)، Catalog (أصناف + سلّم وحدات مرن + باركود GS1 + أسعار + سعر رسمي + أسعار صرف)، Inventory (استلام، أرصدة، FEFO preview، حالات الدفعات، تسويات، تحويلات، كاردكس، worklist الانتهاء). **36 اختبار E2E** على PostgreSQL حقيقي.

**المهمة التالية بالضبط (بالترتيب):**
1. **domain المتبقي:** `purchasing/supplier-invoice.ts` + `purchase-return.ts` + `supplier-ledger.ts` (وكيل B5 انقطع — المخرج الجزئي في `.tmp_agents/B5-purchasing-payables.json` غير صالح؛ أعد التشغيل بتقسيم أصغر، max_tokens 26000) و`accounting/posting-rules-treasury.ts`. رفع العتبات إلى 100% بعد تغطية الفروع المتبقية في `sales-invoice.ts`.
2. **apps/api — Sales + Shifts:** افتح/أغلق وردية، فاتورة بيع (DRAFT→POSTED داخل معاملة واحدة: SALE movements + journal entry + cash_movements + invoice_payments) باستخدام `SalesInvoice`/`settleInvoice`/`postSale*` من domain؛ مرتجعات؛ عملاء. ثم Purchasing (PO/GRN/Supplier invoice/returns/payments) ثم Cash/Expenses ثم Reports.
3. OpenAPI (`@nestjs/swagger` مثبّت) + حزمة i18n لرسائل الأخطاء (ar/en) حسب `code`.
4. `apps/web` React + Vite + Tailwind RTL/LTR + POS لوحة-مفاتيح-أولاً.
5. `apps/desktop` Tauri 2 + PostgreSQL مضمّن كخدمة Windows + مثبّت (اختبار نهائي على جهاز Windows عند الفريق).

**قواعد تشغيل الوكلاء (مستفادة):** استخدم `tools/agents/run_agents.py` (SSE)؛ النماذج المسموحة فقط `claude-opus-5-5` و`claude-fable-5-1`؛ مهام ≤ 2–3 ملفات لكل وكيل، `max_tokens ≤ 26000`، وإلا يقطع الناتج (`fin=length`)؛ استخدم `tools/agents/salvage.py` لاستخراج الملفات الكاملة من JSON مقطوع. **عطّل core dumps** (`ulimit -c 0`) — تسرّب ملف core بحجم 2.3GB مرة وتم تنظيفه من التاريخ.

**قاعدة بيانات الاختبار محلياً:** `postgres://pharmacore:pharmacore@localhost:5432/pharmacore_test` (PostgreSQL 17 في الـ sandbox؛ الهدف الرسمي 16).

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
