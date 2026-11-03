# R2 — دراسة المشاريع مفتوحة المصدر المشابهة

> **الهدف:** (طلب معين) دراسة مشاريع GitHub جاهزة لأنظمة صيدليات — ما نستفيد منه، ما نتجنبه، وهل نبني عليها أم من الصفر.
> **النتيجة المختصرة:** لا يوجد مشروع مفتوح المصدر ناضج بمستوى مؤسسي لصيدليات صغيرة بالـ Stack المستهدف. **نبني من الصفر** (يؤكد قرار D-013) مع الاستفادة من أنماط Odoo/ERPNext في التصميم فقط.

---

## 1. معايير التقييم
| المعيار | الوزن |
|---|---|
| نضج معماري (فصل طبقات، اختبارات) | 30% |
| نموذج بيانات صحيح (Lots، Ledger، قيد مزدوج) | 30% |
| Stack قريب من هدفنا (TypeScript) | 15% |
| نشاط وصيانة | 15% |
| ترخيص يسمح بالاستفادة | 10% |

## 2. المشاريع المدروسة

| المشروع | Stack | الميزات | التقييم | ما نستفيده |
|---|---|---|---|---|
| **Odoo** (Inventory/POS/Accounting) | Python/PostgreSQL | Lots، 4 تواريخ، FEFO، قيد مزدوج، POS أوفلاين جزئي | ⭐⭐⭐⭐⭐ ناضج جداً لكن ثقيل وليس TS، LGPL | **أنماط التصميم**: نموذج الدفعات والتواريخ، removal strategy على مستوى الفئة/الموقع، POS يعمل بـ IndexedDB ثم يزامن |
| **ERPNext / Frappe Health** | Python/MariaDB | Batch/Expiry، Reorder، محاسبة كاملة | ⭐⭐⭐⭐ ناضج، GPL | Stock Ledger Entry كجدول حركات، Valuation Rate لكل حركة، منع المخزون السالب كإعداد |
| **MEDISTOCK (MrAhmed31)** | NestJS + React | مخزون + تتبع انتهاء | ⭐ 0 نجوم، مشروع تعليمي | Stack مطابق لكن لا قيمة معمارية؛ تأكيد أن المجال خالٍ من بدائل TS ناضجة |
| **SalahKhadir/Pharmacy-Management-System** | Java Swing + MySQL | RBAC، مخزون | ⭐⭐ ديسكتوب تقليدي | تدفقات الشاشات فقط |
| **DAVIXSX/pharmacy-management-system** | Flask + Firebase | مخزون، وصفات، طلبات | ⭐⭐ | لا شيء — Firebase لا يناسب Offline/ملكية |
| **Jobayer98/pharmacy-management-system** | ويب | مشتريات، مخزون، مبيعات لصيدلية واحدة | ⭐⭐ | قائمة الـ use cases |
| **chorfichaymaa101 / Tundebangs4L** | React فقط | CRUD واجهة | ⭐ | لا شيء |
| **Laravel pharmacy systems** (متعددة) | PHP/MySQL | POS + مخزون | ⭐⭐ | لا شيء تقنياً |
| **felipfr/nestjs-nx-modular-monolith** | NestJS + Nx + Prisma | **قالب معماري** Modular Monolith | ⭐⭐⭐⭐ | **هيكل المشروع**: تقسيم Modules، حدود واضحة، Nx/Turborepo |
| **andrea-acampora/nestjs-ddd-devops** | NestJS + DDD + Clean Arch | قالب DDD + CI/CD | ⭐⭐⭐⭐ | **بنية الطبقات** Domain/Application/Infrastructure + DevOps |
| **Square "Books"** (مقال هندسي) | — | قاعدة بيانات محاسبية Immutable | ⭐⭐⭐⭐⭐ مرجع تصميمي | **تصميم الدفاتر**: journal_entries + book_entries، لا UPDATE أبداً، التصحيح بقيد جديد |

## 3. الأنماط المستخلصة (Design Patterns نأخذها)
1. **Stock Ledger Entry** (ERPNext) → جدول `stock_movements` append-only: كل حركة لها `qty_delta` (± بأصغر وحدة)، `lot_id`, `location_id`, `unit_cost`, `reference_type/id`, `posted_at`. الرصيد = SUM. [3]
2. **Lot dates** (Odoo) → `expiry_date`, `alert_date` (محسوب = expiry − N يوم، N قابل للتهيئة)، `removal_date` اختياري. [2]
3. **Removal strategy** (Odoo) → سياسة على مستوى الفئة ثم الموقع ثم الافتراضي (FEFO). [2]
4. **POS Offline** (Odoo POS) → الطلبات تُحفظ محلياً وتُزامن لاحقاً مع معرّف فريد لمنع التكرار (Idempotency). [2]
5. **Double-Entry Immutable** (Square Books) → `journal_entries` + `journal_lines`، SUM(debit) = SUM(credit) كقيد قاعدة بيانات، العكس بقيد جديد. [11]
6. **Modular Monolith** (felipfr, acampora) → `apps/api/src/modules/<context>/{domain,application,infrastructure,presentation}`. [9][10]

## 4. ما نتجنبه (Anti-patterns شائعة في المشاريع الصغيرة)
- ❌ تخزين `quantity` كعمود قابل للتحديث في جدول الأصناف (يفقد التاريخ ويسمح بالتلاعب).
- ❌ Float للأسعار.
- ❌ حذف/تعديل الفواتير مباشرة.
- ❌ منطق الأعمال داخل Controllers أو داخل الواجهة.
- ❌ Firebase/خدمات سحابية إلزامية (تناقض الملكية والـ Offline).
- ❌ تاريخ انتهاء على مستوى الصنف بدلاً من الدفعة.

## 5. القرار
- **لا Fork**. نبني Monorepo جديد.
- نستخدم القوالب المعمارية (felipfr / acampora) **كمرجع هيكلي** فقط.
- نوثّق الأنماط المأخوذة في `docs/05-data/` و `docs/04-architecture/`.

## المصادر
1. GitHub Topic pharmacy-system: https://github.com/topics/pharmacy-system
2. Odoo FEFO: https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html
3. Frappe Health Pharmacy Setup: https://frappehealth.com/docs/v13/user/manual/en/healthcare/setup_pharmacy
4. MEDISTOCK NestJS: https://github.com/MrAhmed31/MEDISTOCK-PROJECT-NESTJS
5. SalahKhadir: https://github.com/SalahKhadir/Pharmacy-Management-System
6. DAVIXSX: https://github.com/DAVIXSX/pharmacy-management-system
7. Jobayer98: https://github.com/Jobayer98/pharmacy-management-system
8. bdtask Top 10 pharmacy software with source: https://www.bdtask.com/blog/top-pharmacy-software
9. felipfr/nestjs-nx-modular-monolith-microservices: https://github.com/felipfr/nestjs-nx-modular-monolith-microservices
10. andrea-acampora/nestjs-ddd-devops: https://andrea-acampora.github.io/nestjs-ddd-devops/
11. Square Engineering — Books, an immutable double-entry accounting database: https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/
