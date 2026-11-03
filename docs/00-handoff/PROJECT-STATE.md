# PROJECT-STATE — الحالة الحالية للمشروع (المصدر الوحيد للحقيقة)

> **آخر تحديث:** 2026-11-03 — نهاية الجلسة #1
> **من يحدّث هذا الملف:** أي وكيل/مطور في نهاية كل جلسة.
> **قاعدة:** إذا تعارض هذا الملف مع أي ملف آخر، هذا الملف هو المرجع للحالة الحالية.

---

## 1. المرحلة الحالية
| البند | القيمة |
|---|---|
| المرحلة | **Phase 1 — Discovery, Research & Architecture** |
| الحالة | قيد التنفيذ |
| نسبة الإنجاز التقديرية للمرحلة | **~90%** — التوثيق مكتمل؛ بانتظار اعتماد الفريق + تأكيد العميل (المرحلة 0) |
| هل يوجد كود تطبيق؟ | **لا** — التوثيق والتصميم فقط |
| الفرع النشط | `genspark_ai_developer` |
| آخر PR | https://github.com/moain2028/Pharmacy-System/pull/1 |

## 2. المهمة التالية بالضبط (Next Action)
> **ابدأ من هنا إذا كنت وكيلاً جديداً.**

**المرحلة 1 (التوثيق) مكتملة + المتطلبات التفصيلية "حرف حرف" مكتملة (Session #3).** قرارات المالك D-023..D-031 معتمدة (Stack، Windows أولاً، ثنائي اللغة، وحدات مرنة، 4 عملات، خصومات بضوابط، سعر رسمي، صلاحيات دقيقة، فريق الوكلاء).
**المهمة التالية بالضبط = بدء الكود (المرحلة 2 — الأساس)** بفريق الوكلاء وفق D-031، بالترتيب:
1. Monorepo (pnpm + Turborepo) + CI (typecheck/lint/test) + `tools/agents` جاهز.
2. `packages/domain`: `Money` (BIGINT minor + currency، Half-Up، allocate)، `Quantity` (SSU BIGINT)، `UnitConversion` (factor_to_ssu + snapshot)، `Result`، UUIDv7 — تغطية 100%.
3. `packages/db`: Drizzle schema بالقاموس الموحّد (`07-CROSS-REVIEW §4`) + هجرات SQL + Triggers (append-only، protect_posted، balanced_entry) + اختبارات تثبت الرفض.
4. `apps/api` (NestJS/Fastify، Hexagonal): Identity (Argon2id/JWT/permissions `resource.action`) → Catalog+Units → Inventory/Lots/FEFO → Sales+Shifts → Purchasing → Cash/Expenses → Reports.
5. `apps/web` React RTL/LTR i18n + شاشة POS لوحة-مفاتيح-أولاً.
6. `apps/desktop` Tauri 2 + تغليف PostgreSQL كخدمة Windows + مثبّت (يحتاج جهاز Windows للاختبار النهائي — عند الفريق).
المهام البشرية المتبقية (لا تعطّل الكود):
1. **الفريق يشاهد `media/video/explainer.mp4` (v2 — Motion Graphics، بدون أسماء) ويراجع التوثيق** → يسجّل ملاحظاته كـ Issues أو تعديلات على الملفات.
   - قرار جديد يحتاج تأكيد الفريق: **D-022** (وضع تجاري في الواجهة + محرك قيد مزدوج داخلي + علم `accounting_full`).
2. **اعتماد ADR-002 (Tech Stack)** — تصويت معين/مازن/عبدالكريم → تغيير الحالة من Proposed إلى Accepted في `adr/README.md` و`DECISIONS-LOG` (P-001, P-002).
3. **المرحلة 0:** جلسة مع صاحب الصيدلية باستخدام `docs/02-requirements/CLIENT-QUESTIONNAIRE.md` → إغلاق Q1–Q7 هنا وتحديث أولويات SRS.
4. **اعتماد التسعير** (P-003) من `docs/10-business/PRICING.md` → إعداد العرض للعميل → استلام المقدم (M0).
5. **بدء المرحلة 2 (الأساس)** حسب `docs/09-delivery/ROADMAP.md` WBS-2: Monorepo + CI + packages/domain/shared + Prisma schema + Triggers. أول PR كود يجب أن يحتوي: `Money`, `Quantity`, `Result`, UUIDv7 generator باختبارات 100%.
6. ملاحظة: أي وكيل يبدأ الكود **يجب** أن يقرأ `ENGINEERING-RULES.md` و`DOMAIN-MODEL.md` و`DATA-MODEL.md` أولاً.

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
