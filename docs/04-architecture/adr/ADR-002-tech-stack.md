# ADR-002: Tech Stack — TypeScript End-to-End

- **الحالة:** **Proposed** — بانتظار اعتماد الفريق (P-001, P-002)
- **المتطلبات:** CH-N05 (مقترح مازن)، CON-05، NFR-PERF-005، NFR-PORT-*
- **البحث:** R5 TECH-STACK-COMPARISON

## السياق
نحتاج نواة واحدة تخدم الويب والديسكتوب والموبايل، تعمل على أجهزة بـ 4GB RAM بدون إنترنت، بلغة واحدة يتقنها الفريق ووكلاء AI، مع قاعدة بيانات علائقية ACID.

## القرار
| الطبقة | الاختيار | الإصدار |
|---|---|---|
| اللغة | TypeScript (strict) | 5.x |
| Runtime | Node.js LTS | 22 |
| Backend | **NestJS** | 10 |
| ORM | **Prisma** (+ `$queryRaw` للتقارير/Ledger) | 5.x |
| DB (افتراضي/خادم/سحابة) | **PostgreSQL** (pg_trgm, pgcrypto, RLS) | 16 |
| DB (Lite/جهاز واحد) | **SQLite** (WAL) بنفس Prisma schema | 3.4x |
| Frontend | **React + Vite + TypeScript** | 18 / 5 |
| UI | **TailwindCSS + shadcn/ui (Radix)** RTL | 3.x |
| حالة/بيانات | TanStack Query + Zustand + React Hook Form + Zod | — |
| Desktop | **Tauri 2** (Rust shell + Node sidecar) | 2.x |
| Mobile (لاحقاً) | Tauri 2 Mobile أو Capacitor؛ PWA أولاً | — |
| Monorepo | pnpm workspaces + Turborepo | — |
| اختبار | Vitest · Supertest · Playwright · k6 | — |
| CI/CD | GitHub Actions · Changesets | — |
| طباعة | Node sidecar `escpos` Raster | — |
| License Server | Hono على Cloudflare Workers + D1 (أو Nest) | — |

### وضع العميل الأول
**Lite:** Tauri + sidecar (NestJS + SQLite) على جهاز واحد. ترقية إلى PostgreSQL محلي عند إضافة أجهزة عبر أداة ترحيل مضمّنة.

## البدائل المرفوضة
- Hono/Fastify للـ API: أخف لكن بلا هيكل؛ نحتفظ به لـ License Server/Edge.
- Drizzle: جيد؛ يُعاد التقييم إن ظهرت مشاكل أداء Prisma.
- Electron: 150–400MB RAM — لا يناسب الأجهزة المستهدفة.
- Flutter/.NET: لغة ثانية.
- MySQL/SQL Server: أضعف في NUMERIC/RLS/الامتدادات أو مرخّص.

## النتائج
- ✅ مشاركة `packages/domain` و`packages/shared` (Zod) بين كل التطبيقات.
- ✅ حجم تطبيق ~10MB وذاكرة ~80MB للعميل.
- ⚠️ SQLite بلا NUMERIC → نعتمد BIGINT minor (ADR-008) فيصبح الفرق غير مؤثر.
- ⚠️ فروق Prisma بين PostgreSQL/SQLite (RLS، pg_trgm) → تُعزل في Adapters وتُوثق في docs/05-data.
- ⚠️ Rust toolchain في CI للـ Tauri.

## ما يلزم لاعتماده
تصويت الفريق (معين، مازن، عبدالكريم) + تجربة PoC سريعة لـ Tauri sidecar + SQLite على Windows 10 بـ 4GB.
