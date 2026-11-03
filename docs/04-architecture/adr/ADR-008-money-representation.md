# ADR-008: تمثيل الأموال — BIGINT بأصغر وحدة نقدية + رمز العملة

- **الحالة:** Accepted — 2026-11-03
- **القرار المرتبط:** D-006 (مازن: لا Float)
- **المتطلبات:** CON-02، NFR-CUR-001

## السياق
Float يسبب أخطاء تراكمية (0.1+0.2≠0.3). PostgreSQL يملك NUMERIC لكن SQLite لا؛ نريد تمثيلاً موحداً عبر القاعدتين وفي TypeScript.

## القرار
1. **DB:** `amount_minor BIGINT NOT NULL` + `currency CHAR(3) NOT NULL` لكل مبلغ. (YER: minor = ريال لعدم استخدام الفلس عملياً؛ SAR/USD: هللة/سنت — حسب `minor_units` في جدول `currencies` من ISO 4217.)
2. **TS:** `Money { amountMinor: bigint; currency }` Value Object غير قابل للتغيير؛ عمليات: `add/sub/mulRate/allocate/round/format`.
3. **الأسعار** (صرف، نسب): `NUMERIC(18,8)` / `Decimal` — ليست أموالاً.
4. **التقريب** مرة واحدة عند الترحيل (`HALF_UP` افتراضياً، قابل للتهيئة) ويُحفظ الناتج.
5. **العرض** عبر `Intl.NumberFormat('ar-YE')` مع خيار الأرقام العربية-الهندية.
6. ممنوع `number` لحقول المبالغ (lint).

## البدائل المرفوضة
- `NUMERIC(18,4)` فقط: غير موحّد مع SQLite؛ أبطأ في JS.
- `DECIMAL` كنص في JS: أبطأ وأكثر عرضة للخطأ من `bigint`.
- Float: مرفوض نهائياً.

## النتائج
- ✅ دقة مطلقة، تمثيل موحّد، متوافق مع Stripe/Square.
- ⚠️ `bigint` في JSON → يُسلسل كنص؛ Zod transform عند الحدود.
