# استراتيجية الاختبار والجودة (Test Strategy & Definition of Done)

> **المعايير:** ISTQB (مستويات/أنواع)، Test Pyramid، ISO/IEC 25010 (خصائص الجودة القابلة للقياس). التغطية والبوابات مفروضة في CI.

---

## 1. هرم الاختبار
```
            ┌───────────────┐
            │  E2E (5%)     │  Playwright — المسارات الحرجة فقط
            ├───────────────┤
            │ Integration   │  Supertest + DB حقيقية (Testcontainers PG / SQLite memory)
            │   (25%)       │  كل Use Case يلمس DB · قيود DB · RLS
            ├───────────────┤
            │ Unit (70%)    │  Vitest — packages/domain (Aggregates, VOs, Domain Services, PostingRules)
            └───────────────┘
  + Contract (OpenAPI diff) + Non-functional (k6, crash, restore, axe, ASVS)
```

## 2. ما يُختبر في كل مستوى

### 2.1 Unit (packages/domain) — هدف تغطية ≥ 80%، Invariants 100%
| المجال | حالات إلزامية |
|---|---|
| `Money` | جمع/طرح بنفس العملة؛ رفض عملتين؛ `allocate` بلا فقد؛ تقريب HALF_UP؛ `bigint` serialization |
| `Quantity`/`UnitFactor` | تحويل علبة→SSU؛ رفض السالب/الكسر |
| `Item` | وحدة أساسية واحدة؛ factor فريد؛ لا حذف مع حركات |
| `Lot` | expiry > received؛ alert_date محسوب؛ لا تعديل بعد حركة |
| `FefoAllocator` | ترتيب بالانتهاء ثم الاستلام؛ تجاهل المنتهي؛ تقسيم على دفعات؛ `InsufficientStock`؛ `preferLotId` |
| `StockLedger` | append فقط؛ رفض السالب (إلا سياسة)؛ رفض بيع منتهٍ |
| `SalesInvoice` | Draft قابل للتعديل؛ Posted لا؛ Σpayments؛ خصم ≤ حد؛ حد ائتمان؛ ترقيم؛ وردية مفتوحة |
| `Shift` | وردية واحدة مفتوحة؛ الفرق عند الإقفال |
| `PurchaseInvoice` | Lot لكل سطر؛ بونص حسب السياسة؛ خصم يخفّض التكلفة |
| `JournalEntry` | Σd=Σc؛ سطر مدين XOR دائن؛ reversal |
| `PostingRules` | **كل PR-01..PR-17** بأمثلة رقمية من ACCOUNTING-DESIGN |
| `StocktakeSession` | snapshot؛ variances؛ لا ترحيل مرتين |
| `AuthorizationPolicy` | مصفوفة RBAC (إيجابي/سلبي) |
| `LicenseVerifier` | توقيع صحيح/مزوّر؛ mid مطابق/مختلف/تسامح؛ exp/grace؛ clock rollback |

### 2.2 Integration (apps/api)
- كل Command Handler: نجاح + كل مسار فشل → rollback كامل (لا حركات/قيود يتيمة).
- قيود DB: Trigger immutability (محاولة UPDATE على `stock_movements` → خطأ)؛ posted protection؛ deferred balance؛ not-expired؛ partial uniques.
- RLS: مستأجر A لا يرى بيانات B (PostgreSQL).
- Idempotency: إعادة إرسال نفس `idempotency_key` → نفس النتيجة بلا تكرار.
- Projections: `rebuild-projections` يطابق الحالة الحية.
- SQLite parity: نفس مجموعة الاختبارات تعمل على SQLite (ما عدا RLS) في CI matrix.

### 2.3 E2E (apps/web via Playwright)
| السيناريو | المعرّف |
|---|---|
| دخول → فتح وردية → بيع نقدي بمسح → طباعة (mock) → إقفال | E2E-01 |
| بيع آجل لعميل بحد ائتمان؛ تجاوز → موافقة PIN | E2E-02 |
| مرتجع جزئي من فاتورة → المخزون والحساب يعودان | E2E-03 |
| استلام مشتريات بدفعتين مختلفتي الانتهاء → بيع يأخذ الأقرب (FEFO) | E2E-04 |
| محاولة بيع منتهٍ → مرفوض مع بديل | E2E-05 |
| جرد مع عجز → ترحيل → تقرير | E2E-06 |
| انقطاع (إعادة تحميل الصفحة) أثناء مسودة → استرجاع | E2E-07 |
| تفعيل ترخيص أوفلاين؛ توكن مزوّر مرفوض | E2E-08 |
| نسخ احتياطي → استعادة → البيانات مطابقة | E2E-09 |
| RTL + لوحة مفاتيح فقط لكل E2E-01 | E2E-10 |

### 2.4 غير الوظيفية
| الاختبار | الأداة | الهدف |
|---|---|---|
| أداء POS (إضافة صنف، ترحيل) | Playwright timing + k6 على API | NFR-PERF-001/002 |
| بحث 50k صنف | k6 + seed | NFR-PERF-003 |
| قطع الطاقة | kill -9 للـ API/DB أثناء ترحيل ×20 | NFR-REL-001: صفر مستندات نصف مرحّلة |
| استعادة النسخة | سكربت | NFR-REL-003 ≤ 15 دقيقة |
| الذاكرة | قياس على Windows 10 / 4GB | NFR-PERF-005 |
| إمكانية الوصول | axe-core في Playwright | NFR-USE-003 صفر critical |
| الأمن | ASVS checklist + `pnpm audit` + ZAP baseline | NFR-SEC-004 |
| الطباعة | 3 طابعات حرارية شائعة (Xprinter, Rongta, Epson-compatible) | NFR-COMP-002 |
| سهولة التعلم | 3 مستخدمين جدد | NFR-USE-001 |

## 3. بيانات الاختبار
- Seed واقعي: 2,000 صنف يمني شائع (أسماء عربية/إنجليزية)، 50 مورد، 200 عميل، 20k فاتورة، دفعات بتواريخ متنوعة.
- Factories (`@faker-js/faker` بالعربية) لكل Aggregate.
- سيناريوهات "ذهبية" (Golden) للمحاسبة: مجموعة مستندات → ميزان مراجعة متوقع (snapshot).

## 4. بوابات CI (Quality Gates)
| البوابة | الشرط |
|---|---|
| Lint/Typecheck | صفر أخطاء؛ boundaries؛ no-float-money |
| Unit | ✅ + coverage domain ≥ 80% |
| Integration | ✅ على PG + SQLite |
| E2E | ✅ المسارات الحرجة (على PR إلى main) |
| Build | web + api + tauri (Windows) |
| Security | gitleaks، pnpm audit (high=fail) |
| OpenAPI | لا breaking change بدون bump |
| Size | bundle web ≤ 1.5MB gz |

## 5. تعريف الجاهزية (Definition of Done) — لكل FR
- [ ] الكود في الطبقة الصحيحة ويتبع ENGINEERING-RULES
- [ ] Unit tests للـ Domain + Integration إن لمس DB
- [ ] E2E إن كان مساراً حرجاً
- [ ] OpenAPI محدّث + أنواع الواجهة مولّدة
- [ ] i18n (ar) + RTL + hotkeys + a11y
- [ ] تحديث TRACEABILITY.md (FR → اختبارات)
- [ ] مراجعة PR من شخص آخر (أو وكيل مراجع) + CI أخضر
- [ ] CHANGELOG (changeset)

## 6. إدارة العيوب
- GitHub Issues بقوالب: Bug (خطوات، متوقع/فعلي، إصدار، بيئة، لقطة)، Feature، Tech-debt.
- الخطورة: S1 (فقد بيانات/مال/أمن — إصلاح فوري وhotfix)، S2 (تعطل وظيفة رئيسية)، S3، S4.
- كل S1/S2 يحصل على اختبار انحدار (regression test) قبل الإغلاق.

## 7. UAT مع العميل
انظر `docs/09-delivery/UAT-PLAN.md` — سيناريوهات UAT-00..UAT-10 بتوقيع العميل.
