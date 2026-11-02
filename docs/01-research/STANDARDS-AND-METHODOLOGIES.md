# R3 — المعايير والمنهجيات العالمية المعتمدة في المشروع

> **الهدف:** تحديد "ماذا يعني العمل بالمعايير العالمية" بشكل ملموس وقابل للتطبيق في كل مرحلة، وليس كشعار.
> كل معيار له: ما هو، لماذا نحتاجه، كيف نطبقه هنا، أين يظهر في المستودع.

---

## 1. خريطة المعايير على دورة حياة المشروع

```
المتطلبات ──► التصميم ──► البيانات ──► الأمن ──► الواجهة ──► الجودة ──► التسليم
ISO 29148     DDD + C4     3NF/Ledger   OWASP     WCAG 2.1   ISO 25010   SemVer
EARS          ADR          GS1/FEFO     ASVS L2   Nielsen    ISTQB       Conventional
              Hexagonal    GAAP/IFRS    ISO 27001 Material   Test Pyr.   Commits
```

## 2. المعايير بالتفصيل

### 2.1 ISO/IEC/IEEE 29148:2018 — هندسة المتطلبات
- **ما هو:** المعيار الدولي لعمليات ووثائق المتطلبات (يحل محل IEEE 830). يحدد خصائص المتطلب الجيد: ضروري، ملائم، لا لبس فيه، كامل، فردي، قابل للتحقق، متسق، قابل للتتبع. [1]
- **كيف نطبقه:** `docs/02-requirements/SRS.md` يتبع هيكل المعيار: Purpose, Scope, Product Overview, Functions, User Characteristics, Constraints, Assumptions, Specific Requirements (Functional, Usability, Performance, Interfaces, Data, Security...), Verification, Appendices.
- **صياغة المتطلبات:** نستخدم **EARS** (Easy Approach to Requirements Syntax): `WHEN <trigger> THE SYSTEM SHALL <response>` / `WHILE <state>` / `IF <condition> THEN`. [2]
- **كل متطلب له معرّف** (`FR-SAL-001`) وأولوية MoSCoW ومصدر (CH-F01 من المحادثات) وطريقة تحقق.

### 2.2 Domain-Driven Design (DDD) — Eric Evans / Vaughn Vernon
- **ما هو:** منهجية تصميم تضع منطق الأعمال في مركز النظام عبر: Ubiquitous Language، Bounded Contexts، Aggregates، Entities، Value Objects، Domain Events، Repositories.
- **لماذا:** الصيدلية مجال معقد (مخزون بدفعات + محاسبة + مبيعات) والحدود الواضحة تمنع "كرة الطين" وتسمح بتفكيك النظام لاحقاً.
- **كيف:** `docs/03-domain/` — خريطة السياقات (Context Map)، كل Aggregate مع قواعده الثابتة (Invariants)، الأحداث بين السياقات.

### 2.3 C4 Model — Simon Brown
- **ما هو:** 4 مستويات لمخططات المعمارية: Context → Container → Component → Code.
- **كيف:** `docs/04-architecture/ARCHITECTURE.md` يحتوي L1–L3 بـ Mermaid. L4 يُولَّد من الكود لاحقاً.

### 2.4 Architecture Decision Records (ADR) — Michael Nygard
- **ما هو:** وثيقة قصيرة لكل قرار معماري: Context, Decision, Consequences, Status.
- **كيف:** `docs/04-architecture/adr/ADR-NNN-title.md`. لا يُحذف ADR؛ يُستبدل بـ Superseded.

### 2.5 Hexagonal Architecture (Ports & Adapters) — Alistair Cockburn + Clean Architecture
- **ما هو:** الـ Domain في المركز لا يعتمد على أي إطار؛ الخارج (DB, HTTP, Printer) يتصل عبر Ports (Interfaces) و Adapters.
- **لماذا:** يسمح بتبديل PostgreSQL ↔ SQLite، أو NestJS ↔ أي إطار، أو ويب ↔ ديسكتوب بدون لمس منطق الأعمال. هذا جوهر "المرونة" المطلوبة.

### 2.6 Modular Monolith
- **ما هو:** تطبيق واحد قابل للنشر، مقسم داخلياً لوحدات بحدود صارمة (لا استيراد مباشر بين الوحدات إلا عبر واجهات عامة/أحداث).
- **لماذا:** صيدلية صغيرة = جهاز واحد؛ Microservices مبالغة. لكن الحدود الصارمة تجعل التفكيك لاحقاً ممكناً عند الحاجة (SaaS كبير).
- **الأداة:** Nx أو Turborepo + ESLint boundaries rules لمنع الاستيراد العابر.

### 2.7 ISO/IEC 25010:2023 — جودة المنتج البرمجي
- **ما هو:** 9 خصائص جودة: Functional Suitability, Performance Efficiency, Compatibility, Interaction Capability (Usability), Reliability, Security, Maintainability, Flexibility (Portability), Safety.
- **كيف:** كل خاصية لها متطلبات غير وظيفية قابلة للقياس في SRS §4 (مثال: زمن إتمام بيع ≤ 2 ثانية، استرجاع النسخة الاحتياطية ≤ 15 دقيقة، تغطية اختبار Domain ≥ 80%).

### 2.8 GS1 Standards (Healthcare) — ترميز المنتجات والدفعات
- **ما هو:** GTIN (رقم المنتج)، GS1-128/DataMatrix مع Application Identifiers: `(01)` GTIN، `(10)` Lot، `(17)` Expiry YYMMDD، `(21)` Serial. هرمية التعبئة (Each → Pack → Case). [3]
- **كيف:** ماسح الباركود يحلل GS1 AI إن وُجد ويملأ الدفعة والانتهاء تلقائياً؛ وإلا EAN-13 عادي. هرمية الوحدات تتبع نموذج GS1.

### 2.9 FEFO (First-Expired-First-Out)
- **ما هو:** سياسة صرف المخزون القابل للانتهاء: الأقرب انتهاءً يُصرف أولاً. معيار في الصيدلة والأغذية (Odoo, NetSuite, SAP). [4]
- **كيف:** افتراضي في POS؛ تجاوز يدوي بصلاحية وتسجيل سبب.

### 2.10 GAAP / IFRS — المبادئ المحاسبية (القيد المزدوج)
- **ما هو:** كل حدث مالي = مدين ودائن متساويان. المخزون أصل؛ تكلفة البضاعة المباعة (COGS) تُسجل عند البيع. **IFRS يمنع LIFO** ويسمح FIFO أو المتوسط المرجح. [5]
- **كيف:** `docs/05-data/ACCOUNTING-DESIGN.md` — دليل حسابات افتراضي، قيود تلقائية لكل عملية، تقييم المخزون بالمتوسط المرجح المتحرك (أو تكلفة الدفعة الفعلية لأننا نتتبع الدفعات — **Specific Identification** وهو الأدق للصيدليات).

### 2.11 OWASP ASVS 4.0 (Level 2) + OWASP Top 10
- **ما هو:** معيار التحقق من أمان التطبيقات؛ L2 مناسب للتطبيقات التي تتعامل مع بيانات مالية.
- **كيف:** `docs/06-security/SECURITY.md` — قائمة تحقق ASVS مختصرة، Argon2id لكلمات المرور، JWT قصير العمر + Refresh، RBAC، تشفير النسخ الاحتياطية، سجل تدقيق.

### 2.12 ISO/IEC 27001 (مبادئ) — أمن المعلومات
- **كيف نستفيد:** مبادئ النسخ الاحتياطي، التحكم في الوصول، سجلات التدقيق، إدارة التغيير. لا نسعى للشهادة الآن.

### 2.13 WCAG 2.1 AA + Nielsen's 10 Heuristics + Material/Fluent guidelines
- **كيف:** `docs/07-ux/` — تباين ألوان ≥ 4.5:1، أهداف لمس ≥ 44px، تنقل كامل بلوحة المفاتيح، RTL أصلي، رسائل خطأ واضحة، منع الأخطاء (تأكيد قبل الترحيل).

### 2.14 ISTQB / Test Pyramid
- **كيف:** `docs/08-quality/TEST-STRATEGY.md` — Unit (Domain ≥ 80%) → Integration (API + DB) → E2E (Playwright للمسارات الحرجة) → Contract (OpenAPI).

### 2.15 Semantic Versioning 2.0 + Conventional Commits + Keep a Changelog
- **كيف:** `vMAJOR.MINOR.PATCH`، `feat:/fix:/docs:/chore:`، `CHANGELOG.md` تلقائي. يدعم نموذج "رسوم التحديث السنوية" (قرار D-011).

### 2.16 OpenAPI 3.1 — عقد الـ API
- **كيف:** يُولَّد من NestJS (Swagger) ويُراجع قبل التنفيذ؛ العملاء (ويب/ديسكتوب/موبايل) تُولَّد أنواعهم منه.

### 2.17 Twelve-Factor App (مبادئ مختارة)
- Config في البيئة، Logs كتيار، Build/Release/Run منفصلة، Dev/Prod parity.

## 3. ماذا يعني هذا عملياً في كل Pull Request؟
- [ ] المتطلب المرتبط (FR-xxx) مذكور.
- [ ] لا يخالف ADR معتمد أو ENGINEERING-RULES.
- [ ] الكود في الطبقة الصحيحة (Domain بلا تبعيات).
- [ ] اختبارات Unit للـ Domain + Integration إن لمس DB.
- [ ] OpenAPI محدّث إن تغيّر الـ API.
- [ ] Conventional Commit.

## المصادر
1. ISO/IEC/IEEE 29148:2018 — https://ieeexplore.ieee.org/document/8559686 ; ReqView templates: https://www.reqview.com/doc/iso-iec-ieee-29148-templates/
2. EARS notation — Topicary: https://www.topicary.com/blog/software-requirements-specification
3. GS1 DataMatrix Healthcare: https://www.gs1.org/docs/healthcare/MC07_GS1_Datamatrix.pdf ; GS1 traceability implementation: https://www.gs1belu.org/sites/gs1belu/files/2020-07/20191029_implementation_gs1_standards_traceability_medicines_hc_supply_chain_v20_0.pdf
4. Odoo FEFO docs: https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html ; NetSuite FEFO: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_161009052865.html
5. Double-entry for engineers: https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger ; https://www.balanced.software/double-entry-bookkeeping-for-programmers/
6. C4 Model: https://c4model.com ; ADR: https://adr.github.io ; ISO 25010: https://iso25000.com/index.php/en/iso-25000-standards/iso-25010
7. OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/ ; WCAG 2.1: https://www.w3.org/TR/WCAG21/
