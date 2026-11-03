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
| نسبة الإنجاز التقديرية للمرحلة | **~92%** — domain/db/api مكتملة (**94 E2E**، 84+ مسارًا، OpenAPI، نسخ احتياطي، استيراد/تصدير CSV، وضع سطح المكتب أحادي العملية يخدم SPA)؛ web: الأساس + شاشات المشتريات/الذمم/الصندوق/المصروفات (E4) مدمجة ومختبرة؛ desktop: Tauri 2 + سكربتات تثبيت الخدمات + مثبّت NSIS جاهزة للبناء على ويندوز؛ باقي: دمج شاشات POS/الأصناف/المخزون/المبيعات/المرتجعات/العملاء/التقارير/المستخدمين (وكلاء E1,E2a/b,E3a/b,E5a/b)، إكمال smoke test، بناء المثبّت على جهاز ويندوز |
| هل يوجد كود تطبيق؟ | **نعم** — `packages/domain` (919 اختبار، 99.67%)، `packages/db` (migration 0001 + 35 اختبار قاعدة بيانات)، `apps/api` (89 اختبار E2E، 84 مسارًا، OpenAPI على /api/docs)، `apps/web` (أساس: عميل API، مخزن مصادقة، i18n ar/en، Shell RTL/LTR، دخول، معالج إعداد، لوحة) |
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
1. **دمج مخرجات وكلاء الواجهة** — الدفعة الأولى (E1–E5 الكبيرة) **تعطّلت بعد 27 دقيقة** (بث متوقف) فقُتلت وأُعيد إطلاقها كسبع مهام أصغر (`.tmp_agents/jobs_web2.json` → `E1-pos`, `E2a-items`, `E2b-inventory-expiry`, `E3a-sales-returns`, `E3b-customers`, `E5a-reports`, `E5b-accounting-users-settings`؛ السجل `.tmp_agents/run_web2.log`). E4 نجح ودُمج. لكل ملف ناتج: `python3 tools/agents/salvage.py <json> --write --root .` → `cd apps/web && pnpm exec tsc --noEmit && pnpm exec eslint src --max-warnings=0 && pnpm exec vitest run` (اختبار `keys-parity` يفرض تطابق قواميس i18n). إن لم تُنتج مهمة مخرجًا، أعد تشغيلها منفردة بـ `max_tokens` ≤ 16000.
2. **إكمال `tools/smoke/pharmacy-day.mjs`** (يوم كامل في الصيدلية ضد خادم حي؛ يعمل حتى خطوة GRN). الخطوة التالية تفشل لأن `GET /inventory/items/:id/balances` يُرجع شكلاً غير المتوقع بعد GRN المرتبط بأمر شراء — تحقق هل GRN يكتب `stock_movements` بالفعل عند التمرير عبر PO (افحص `purchasing.service.ts` → `receive`)؛ أكمل بقية الخطوات حتى `✅ pharmacy-day smoke passed` ثم أضفه لـ CI كخطوة اختيارية.
3. **تشغيل حي**: `/tmp/run_api.sh` نمط التشغيل (NODE_ENV=production, STATIC_DIR=apps/web/dist, ENABLE_DOCS=true) — الـ API يخدم SPA على `/` و docs على `/api/docs`؛ تحقق من POS كاملًا بلوحة المفاتيح بعد دمج E1.
4. **desktop**: على جهاز ويندوز: `pnpm -w build` → `pnpm --filter @pharmacore/desktop sea` → `fetch:pg` → `tauri build` (يتطلب Rust + NSIS). راجع `apps/desktop/README.md`. ملاحظة: `build-sea.mjs` يحتاج `postject` (`npm i -g postject`).
5. تجربة في الصيدلية → تصحيحات → وسم v0.1.0.

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


## Next actions (after session #8)
1. Salvage + integrate remaining UI agents: E1-pos, E2a-items, E2b-inventory-expiry, E5a-reports (`python3 tools/agents/salvage.py .tmp_agents/<id>.json --write`, register keys in `apps/web/src/i18n/register-features.ts`, then tsc/eslint/vitest).
2. Fix smoke `tools/smoke/pharmacy-day.mjs` GRN stock step; add to CI.
3. Rebuild `apps/web/dist`, verify live POS; Windows: build Tauri installer per `apps/desktop/README.md`.


## Next actions (after session #9)
1. Windows machine: build Tauri installer per `apps/desktop/README.md`; run `pharmacy-day.mjs` against the installed build.
2. UI polish pass on a real screen (RTL spacing, print CSS for 80mm receipt, mobile breakpoints for dashboard/reports).
3. Data: seed a realistic Yemeni item catalogue via `POST /import/items` CSV; user acceptance with the first pharmacy.
4. Verify CI smoke step on main (first run after PR #9).
