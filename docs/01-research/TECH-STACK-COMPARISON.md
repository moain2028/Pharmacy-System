# R5 — مقارنة التقنيات (Tech Stack)

> **الهدف:** اختيار Stack يحقق: نواة واحدة لويب + ديسكتوب + موبايل، Offline-first، خفيف على أجهزة ضعيفة، قابل للتوسع لـ SaaS، وبلغة واحدة لتقليل تكلفة الفريق.
> **المخرج:** توصية → ADR-002.

---

## 1. مبادئ الاختيار
1. **لغة واحدة End-to-End (TypeScript)** — فريق صغير، مشاركة الأنواع والـ Domain بين الخادم والعملاء.
2. **Domain نقي** لا يعتمد على إطار → يُعاد استخدامه في أي عميل.
3. **قاعدة بيانات علائقية ACID** مع NUMERIC حقيقي.
4. **عميل واحد (Web) يُغلّف** كديسكتوب وموبايل بدلاً من 3 قواعد كود.
5. **نضج ومجتمع** (ليس أحدث شيء، بل الأكثر موثوقية).

## 2. Backend Framework

| الخيار | المزايا | العيوب | الحكم |
|---|---|---|---|
| **NestJS** | معماري بطبعه (Modules, DI, Guards, Interceptors)، Swagger مدمج، CQRS package، مجتمع كبير، مناسب لـ Modular Monolith | أثقل قليلاً، منحنى تعلم للـ decorators | ✅ **مختار** — يفرض الانضباط المعماري الذي يحتاجه فريق متعدد |
| Hono / Fastify | خفيف وسريع جداً | بلا هيكل؛ الانضباط يعتمد على الفريق | ⚠️ ممتاز لـ Edge/Serverless لاحقاً (مثل بوابة مالك سحابية) |
| Express | شائع | قديم، بلا TS أصلي، بلا هيكل | ❌ |
| .NET / Spring | قوية جداً مؤسسياً | لغة ثانية، فريق غير متخصص | ❌ |

## 3. ORM / Data Access

| الخيار | المزايا | العيوب | الحكم |
|---|---|---|---|
| **Prisma** | Schema واضح، Migrations، أنواع قوية، دعم PostgreSQL + SQLite بنفس الـ Schema (مع قيود) | Decimal يحتاج `Prisma.Decimal`؛ استعلامات معقدة تحتاج `$queryRaw`؛ أداء أقل من Drizzle في بعض الحالات | ✅ **مختار** للسرعة والوضوح — مع `$queryRaw` للتقارير والـ Ledger |
| Drizzle | قريب من SQL، خفيف، أداء ممتاز | أحدث، migrations أقل نضجاً | ⚠️ بديل قوي؛ يُعاد التقييم عند الحاجة لأداء |
| TypeORM | ناضج | أخطاء أنواع، صيانة أبطأ | ❌ |

**قاعدة:** الـ Repository Interface في Domain؛ Prisma فقط في Infrastructure → استبدال ORM ممكن.

## 4. Database

| الخيار | المزايا | العيوب | الحكم |
|---|---|---|---|
| **PostgreSQL 16** | NUMERIC حقيقي، Row-Level Security (للـ Multi-tenant)، pg_trgm للبحث العربي التقريبي، pgcrypto، Logical Replication (للمزامنة لاحقاً)، JSONB، Triggers لمنع UPDATE على Ledger | يحتاج تثبيت على جهاز العميل (خدمة Windows) | ✅ **مختار للخادم/السحابة والتثبيت المحلي الافتراضي** عبر installer يضمه (Portable PostgreSQL ~50MB) |
| **SQLite** | ملف واحد، صفر تثبيت، سريع، WAL يتحمل انقطاع الكهرباء | لا NUMERIC أصلي (نخزن بالأصغر وحدة كـ INTEGER — هللة/فلس)، لا RLS، بلا replication أصلي | ✅ **مختار كخيار "Lite"** للأجهزة الضعيفة جداً أو تطبيق الجوال المحلي، عبر نفس Prisma schema (مع فروق موثقة) |
| MySQL/MariaDB | شائع محلياً (يمن سوفت تستخدم SQL Server) | أضعف في NUMERIC/RLS/الامتدادات | ❌ |

**قرار تخزين الأموال (تفصيل ADR-002):** تخزين المبالغ كـ **أعداد صحيحة بأصغر وحدة نقدية** (`amount_minor BIGINT`) + `currency_code` — يعمل بشكل مطابق في PostgreSQL و SQLite، ويزيل مشاكل Float نهائياً، ويتوافق مع ممارسات Stripe/Square. NUMERIC يبقى للكميات الكسرية إن وُجدت (لا نتوقعها: المخزون INTEGER بأصغر وحدة بيع).

## 5. Frontend

| الخيار | المزايا | العيوب | الحكم |
|---|---|---|---|
| **React 18 + Vite + TypeScript** | أكبر مجتمع، مكتبات RTL ناضجة، يعمل في Tauri/Capacitor/PWA | — | ✅ **مختار** |
| **TailwindCSS + shadcn/ui (Radix)** | RTL مدمج (`rtl:` variants)، مكونات Accessible (WCAG)، قابلة للتخصيص بالكامل، بلا قفل | — | ✅ **مختار** |
| **TanStack Query + Zustand** | إدارة حالة الخادم/العميل بسيطة | — | ✅ |
| **React Hook Form + Zod** | تحقق مشترك مع الخادم (نفس Zod schemas في `packages/shared`) | — | ✅ |
| Angular / Vue | جيدة | مجتمع RTL أصغر، لا ميزة إضافية | ❌ |

## 6. Desktop Wrapper

| الخيار | الحجم | RAM | المزايا | العيوب | الحكم |
|---|---|---|---|---|---|
| **Tauri 2** | ~5–10 MB | ~50–80 MB | Rust core آمن، Sidecar لتشغيل Node API + PostgreSQL محلياً، تحديث تلقائي، Windows/macOS/Linux + Mobile (iOS/Android) في v2 | يعتمد على WebView2 (مثبت افتراضياً في Win10/11؛ يحتاج تثبيت على Win7/8)، Rust في CI | ✅ **مختار** [1][2] |
| Electron | ~150–200 MB | ~150–400 MB | ناضج، Chromium مضمّن (ثابت) | ثقيل على أجهزة 4GB | ⚠️ بديل احتياطي إن ظهرت مشاكل WebView2 |
| Flutter Desktop | متوسط | متوسط | — | لغة ثانية (Dart) | ❌ |

## 7. Mobile (مرحلة لاحقة)

| الخيار | الحكم |
|---|---|
| **PWA** (أولاً) | ✅ للمالك: تقارير وقراءة؛ صفر تكلفة إضافية |
| **Tauri 2 Mobile** أو **Capacitor** | ✅ لتغليف نفس React في متجر التطبيقات |
| React Native / Flutter | ⚠️ فقط إن احتجنا موبايل-first (كاشير جوال) |

## 8. Offline / Sync Engine (مرحلة SaaS/فروع)
انظر التفاصيل في `OFFLINE-FIRST-SYNC.md`. الخلاصة: **PowerSync** (SQLite محلي ↔ Postgres مركزي، bidirectional، upload queue) هو الأنسب للفروع والجوال؛ **ElectricSQL** للقراءة الحية فقط. المرحلة الأولى (جهاز واحد) لا تحتاج أي sync engine. [3]

## 9. Monorepo & Tooling
| الأداة | الحكم |
|---|---|
| **pnpm workspaces + Turborepo** | ✅ بسيط وسريع؛ Nx بديل إن كبر الفريق |
| **ESLint + Prettier + eslint-plugin-boundaries** | ✅ لمنع الاستيراد بين Modules |
| **Vitest** (unit) + **Supertest** (API) + **Playwright** (E2E) | ✅ |
| **GitHub Actions** | ✅ CI: lint/test/build + إصدار Tauri لـ Windows |
| **Changesets** | ✅ إدارة الإصدارات والـ CHANGELOG |
| **Docker Compose** | ✅ للتطوير والنشر السحابي |

## 10. الطباعة والأجهزة
| الحاجة | الحل |
|---|---|
| طابعة حرارية ESC/POS مع عربية | Tauri sidecar صغير (Node `escpos`/`node-thermal-printer`) يطبع **Raster image** من HTML المولّد → يضمن العربية على أي طابعة [4] |
| قارئ باركود | HID (لوحة مفاتيح) — التقاط عام في POS + تحليل GS1 AI |
| درج النقد | أمر ESC/POS عبر الطابعة |
| طابعة A4 للتقارير | طباعة المتصفح/WebView العادية |

## 11. البديل "Lite" (إن احتجنا أبسط ما يمكن للعميل الأول)
نفس الكود، لكن: Tauri + SQLite (بدون PostgreSQL) + API مضمّن كـ sidecar. مناسب لجهاز واحد. الترقية لـ PostgreSQL عند إضافة أجهزة/فروع عبر أداة ترحيل. **هذا هو الوضع الافتراضي المقترح للعميل الأول** لتقليل مشاكل التركيب — يُحسم في ADR-002.

## 12. التوصية النهائية (ملخص لـ ADR-002)
```
Monorepo (pnpm + Turborepo)
├── apps/api        NestJS 10 + Prisma 5 + PostgreSQL 16 | SQLite (Lite)
├── apps/web        React 18 + Vite + TS + Tailwind + shadcn/ui (PWA)
├── apps/desktop    Tauri 2 (يغلّف web + sidecar: api + db)
├── apps/mobile     (لاحقاً) Tauri 2 Mobile / Capacitor
├── packages/domain       منطق الأعمال النقي (بلا تبعيات)
├── packages/shared       Zod schemas, types, constants, i18n
├── packages/ui           Design System (RTL)
├── packages/license-sdk  تحقق Ed25519 + بصمة الجهاز
└── packages/printing     ESC/POS raster
```

## المصادر
1. Tauri vs Electron benchmarks (2025–2026): https://www.gethopp.app/blog/tauri-vs-electron ; https://www.dolthub.com/blog/2025-11-13-electron-vs-tauri/
2. Tauri v2 vs Electron honest comparison: https://www.buildmvpfast.com/blog/tauri-v2-vs-electron-desktop-apps-2026
3. ElectricSQL vs PowerSync vs Replicache: https://queryplane.com/blog/electricsql-vs-powersync-vs-replicache/
4. Thermal printing Arabic: https://www.quickbiz.pro/thermal-receipt-printer-pos-kuwait ; ESC/POS discussion: https://www.reddit.com/r/csharp/comments/1htizvu/
5. NestJS modular monolith references: https://notes.softwarearchitect.id/p/combining-modular-monolith-and-hexagonal ; https://github.com/felipfr/nestjs-nx-modular-monolith-microservices
