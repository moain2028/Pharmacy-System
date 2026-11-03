# PROJECT-STATE — الحالة الحالية للمشروع (المصدر الوحيد للحقيقة)

> **آخر تحديث:** 2026-11-03 — نهاية الجلسة #13 (PR #13 مدموج في `main`)
> **من يحدّث هذا الملف:** أي وكيل/مطور في نهاية كل جلسة. إذا تعارض مع أي ملف آخر، هذا هو المرجع.
> **وكيل جديد؟** اقرأ `AGENTS.md` → هذا الملف → `SESSION-LOG.md` (آخر جلسة) → `docs/03-design/DESIGN-SYSTEM.md` إن كنت ستلمس الواجهة.

---

## 0. الملخص التنفيذي (30 ثانية)
PharmaCore نظام إدارة صيدليات مؤسسي (عربي/إنجليزي، 4 عملات، FEFO، قيد مزدوج). **الكود مكتمل وظيفيًا ومختبر ومدموج في `main`**: domain (919 اختبار) + db (62 جدولًا، RLS) + API (98 E2E، 84+ مسارًا، OpenAPI) + web (16 وحدة، نظام تصميم موثّق، فاتح/داكن، تدقيق 51/51 × ثيمين) + desktop (Tauri 2 جاهز للبناء على ويندوز). **اختبار "يوم صيدلية كامل" يمر من البداية للنهاية ويعمل في CI.** المتبقي الجوهري: **بناء مثبّت Windows على جهاز Windows** + **قبول المستخدم على شاشة حقيقية**.

## 1. المرحلة الحالية
| البند | القيمة |
|---|---|
| المرحلة | **Phase 2/3/4 مُنجزة كودًا** (Foundation + MVP modules + Purchasing/Accounting/Reporting) — **Phase 5 (Desktop installer) جاهز للبناء** — Phase 6 (UAT) لم تبدأ |
| نسبة الإنجاز التقديرية | **~98%** من نطاق الإصدار v0.1.0 |
| الفرع النشط | `genspark_ai_developer` → PR إلى `main` (كل PRs حتى **#13 مدموجة**) |
| CI | `.github/workflows/ci.yml` — build/typecheck/lint/test:coverage + **smoke يوم كامل ضد API مبني**. آخر حالة معروفة على main: ✅ (بعد PR #10) |
| تشغيل حي للتجربة | `DEMO_MODE=true` → دخول سريع **1/1 (مالك)** و **2/2 (كاشير)**. بيانات تجريبية: `node tools/seed/demo-pharmacy.mjs <url>` |

## 2. ماذا أُنجز (حسب الطبقة)
| الطبقة | المسار | الحالة | الأدلة |
|---|---|---|---|
| Domain (نقي) | `packages/domain` | ✅ | 919 اختبار، تغطية 99.67%؛ Money bigint، FEFO، قيود ترحيل، مطابقة ثلاثية، مرتجعات، ورديات |
| DB | `packages/db` | ✅ | `migrations/0001_foundation.sql` (62 جدولًا، triggers P0001..P0010، RLS FORCE)، 35 اختبار ثوابت |
| API | `apps/api` | ✅ | NestJS/Fastify؛ Identity/Catalog/Inventory/Sales/Returns/Customers/Purchasing/Payables/Treasury/Reports/Backup/Import/DEMO؛ **98 E2E** على PostgreSQL حقيقي؛ OpenAPI `/api/docs`؛ يخدم SPA في وضع أحادي العملية |
| Web | `apps/web` | ✅ | React 18 + Tailwind؛ **16/16 وحدة** حقيقية (POS، مبيعات، مرتجعات، عملاء، أصناف، مخزون، صلاحية، مشتريات، موردون، ذمم، صندوق، مصروفات، تقارير، محاسبة، مستخدمون، إعدادات)؛ 44 اختبار؛ نظام تصميم + 3 مراجعات خبراء مطبّقة؛ قائمة هرمية قابلة للطي؛ breadcrumbs؛ اختصارات؛ ثيم داكن؛ تفضيلات؛ طباعة A4 + 80mm |
| Desktop | `apps/desktop` | 🟡 جاهز للبناء | Tauri 2 shell، Node SEA sidecar، PostgreSQL محمول، WinSW، NSIS hooks؛ **لم يُبنَ بعد (يحتاج Windows)** |
| أدوات | `tools/` | ✅ | `smoke/pharmacy-day.mjs` (يوم كامل)، `seed/demo-pharmacy.mjs`، `ui-audit/{crawl,print,contrast}.mjs`، `agents/` (تشغيل وكلاء) |
| وثائق | `docs/` | ✅ | بحث/متطلبات/DDD/معمارية/ADRs/أمن/جودة/تسليم/أعمال + `03-design` (نظام التصميم + المراجعات) + `00-handoff` |

## 3. ما بقي بالضبط (مرتّب)
| # | المهمة | من | التفاصيل |
|---|---|---|---|
| 1 | **بناء مثبّت Windows** | يحتاج جهاز Windows (Rust + MSVC + NSIS) | `apps/desktop/README.md`: `pnpm -w build` → `pnpm --filter @pharmacore/desktop sea` → `fetch:pg` → `tauri build`. ثم شغّل `node tools/smoke/pharmacy-day.mjs http://localhost:<port>` ضد المثبَّت |
| 2 | **قبول المستخدم على شاشة حقيقية** | المالك + الصيدلية | طابعة 80mm، قارئ باركود، هاتف فعلي. أي ملاحظة → لقطة → تُحلَّل بنفس منهج الجلسة #12 |
| 3 | جداول الجوال كبطاقات | وكيل | طبّق `.table-stack` + `data-th` على قوائم الأصناف/المبيعات/العملاء (CSS جاهز في `styles.css`) |
| 4 | كتالوج الصيدلية الحقيقي | المالك → `POST /import/items` CSV | القالب: `GET /import/templates/items` |
| 5 | تأكيد المتطلبات المفتوحة Q1–Q9 (أدناه) | المالك مع العميل | معظمها مُفترض بالفعل في الكود (وحدات مرنة، آجل، 4 عملات) — التأكيد لا يغيّر البنية |
| 6 | إصدار `v0.1.0` + وسم | بعد 1 و 2 | |

## 4. كيف تُشغّل كل شيء محليًا (للوكيل الجديد)
```bash
pnpm install --frozen-lockfile && pnpm build
# قاعدة بيانات: PostgreSQL 16/17 بمستخدم pharmacore/pharmacore، قاعدتان: pharmacore_dev و pharmacore_test
pnpm typecheck && pnpm lint && pnpm test            # domain 919 · db 35 · api 98 · web 44 · desktop 3
# تشغيل حي (API يخدم الواجهة المبنية):
cd apps/api && NODE_ENV=production PORT=3100 HOST=0.0.0.0 ENABLE_DOCS=true DEMO_MODE=true \
  DATABASE_URL=postgres://pharmacore:pharmacore@localhost:5432/pharmacore_dev \
  JWT_SECRET=<32+ chars> STATIC_DIR=$PWD/../web/dist BACKUP_DIR=/tmp/pc-backups node dist/main.js
node tools/seed/demo-pharmacy.mjs http://localhost:3100      # بيانات واقعية (idempotent)
node tools/smoke/pharmacy-day.mjs http://localhost:3100      # يجب أن ينتهي بـ ✅
# تدقيق الواجهة (يحتاج playwright + chromium):
node tools/ui-audit/crawl.mjs && THEME=dark node tools/ui-audit/crawl.mjs   # يجب ALL CLEAN مرتين
node tools/ui-audit/print.mjs                                                # PDF تقرير A4
```
**ملاحظات تشغيل مهمة:** الـ API يحلّ `@pharmacore/domain` من `dist/` → أعد بناء domain قبل اختبارات API. في هذا الصندوق `fuser -k 3100/tcp` لا يرى الخادم؛ استخدم `ss -ltnp | grep 3100` ثم `kill -9 <pid>`.

## 5. قواعد غير قابلة للتفاوض (مختصر — التفاصيل `docs/04-architecture/ENGINEERING-RULES.md`)
أموال bigint/NUMERIC فقط · مخزون = سجل حركات غير قابل للتعديل بأصغر وحدة · دفعات + FEFO · المرحّل لا يُعدّل (عكس/مرتجع فقط) · قيد مزدوج لكل حدث مالي · `tenant_id` + RLS في كل جدول · Audit Trail · Offline-first · **الواجهة:** لا خطوط/أيقونات من الشبكة، تباين AA، أهداف لمس 48px على اللمس، لا `transform` على حاويات عناصر `fixed`، كل تغيير في الـ shell يمر بـ `tools/ui-audit` (فاتح + داكن).

## 6. الأسئلة المفتوحة مع العميل (لا تعطّل البناء — الكود يدعم كل الاحتمالات)
| # | السؤال | الحالة |
|---|---|---|
| Q1 | بيع بالحبة/الشريط/العلبة؟ | مدعوم (سلّم وحدات مرن) — تأكيد فقط |
| Q2 | بيع آجل؟ | مدعوم (سقف ائتمان + قبض + تخصيص) |
| Q3 | عملات SAR/USD؟ | مدعوم (4 عملات + أسعار صرف) |
| Q4 | عدد المستخدمين/الأجهزة؟ | مدعوم (أدوار + LAN) — يؤثر على الترخيص فقط |
| Q5 | قائمة أصناف جاهزة؟ | أداة استيراد CSV جاهزة |
| Q6 | طابعة حرارية/قارئ باركود؟ | CSS إيصال 80mm + مسح GS1/EAN جاهزان — يحتاج اختبارًا فعليًا |
| Q7 | سعر مختلف لنفس الصنف (مهرّب)؟ | مدعوم عبر سعر رسمي + تجاوز بصلاحية |
| Q8 | اسم المؤسسة | مفتوح |
| Q9 | السعر النهائي | مفتوح (P-003) |

## 7. المخاطر النشطة
1. المثبّت لم يُبنَ على Windows بعد → قد تظهر مشاكل بيئة (PostgreSQL محمول، WinSW). **أعلى أولوية.**
2. لم يُختبر على طابعة حرارية/قارئ حقيقيين.
3. توكن GitHub الشخصي ظهر في محادثة سابقة → **يجب إلغاؤه** (الـ remote في المستودع بدون توكن).
4. الكهرباء/الإنترنت → Offline-first مُطبّق، النسخ الاحتياطي مُطبّق ومختبر (sha256).

## 8. خريطة المراحل
| # | المرحلة | الحالة |
|---|---|---|
| 0 | تأكيد المتطلبات مع العميل | ⏳ (الكود لا ينتظرها) |
| 1 | البحث والتحليل والتصميم | ✅ |
| 2 | Monorepo + domain + db + api | ✅ |
| 3 | Identity → Catalog → Inventory → POS | ✅ |
| 4 | Purchasing → Accounting → Reporting | ✅ |
| 5 | Backup ✅ + Desktop (Tauri) 🟡 + Installer ⏳ (Windows) | 🟡 |
| 6 | UAT + تدريب + تسليم | ⏳ |
| 7 | SaaS متعدد المستأجرين + مزامنة + موبايل | ⏳ (البنية جاهزة: tenant_id + RLS من اليوم الأول) |

## 9. روابط سريعة
- المستودع: https://github.com/moain2028/Pharmacy-System — PRs المدموجة #1…#13
- سجل الجلسات: `docs/00-handoff/SESSION-LOG.md` · القرارات: `DECISIONS-LOG.md` · نظام التصميم: `docs/03-design/DESIGN-SYSTEM.md` · مراجعات الخبراء: `docs/03-design/reviews/`
- Desktop: `apps/desktop/README.md` · OpenAPI: `/api/docs` على أي خادم مُشغَّل
