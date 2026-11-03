# ADR-003: Multi-tenancy من اليوم الأول (tenant_id + Row-Level Security)

- **الحالة:** Accepted — 2026-11-03
- **القرار المرتبط:** D-001, D-018
- **المتطلبات:** CH-N06، FR-IAM-005، NFR-SEC-005، NFR-SCAL-002

## السياق
العميل الأول صيدلية واحدة، لكن الهدف المعلن بيع المنتج لعشرات/مئات الصيدليات، بما فيها SaaS سحابي. إضافة `tenant_id` لاحقاً تعني ترحيل كل جدول وكل استعلام = مكلف وخطر.

## القرار
1. **كل جدول أعمال** يحمل `tenant_id UUID NOT NULL` (وكل جدول مخزني `location_id`).
2. **PostgreSQL RLS** مفعّل على كل جدول أعمال بسياسة `tenant_id = current_setting('app.tenant_id')::uuid`؛ الـ API يضبط الإعداد في بداية كل Transaction من JWT.
3. في SQLite (Lite — مستأجر واحد) يُفرض بالتطبيق (Prisma middleware يحقن `where tenant_id`) — نفس الكود.
4. نموذج **Shared Database, Shared Schema** (الأبسط والأرخص) مع إمكانية الانتقال لـ Schema-per-tenant للعملاء الكبار لاحقاً.
5. `Tenant` يملك إعداداته (عملة، سياسات، قالب فاتورة) و`Location`s.

## البدائل المرفوضة
- بدون tenant الآن: تكلفة لاحقة باهظة.
- Database-per-tenant: تشغيل مكلف لمئات الصيدليات الصغيرة.

## النتائج
- ✅ تفعيل SaaS = تهيئة وليس إعادة كتابة.
- ✅ عزل دفاعي بطبقتين (RLS + التطبيق).
- ⚠️ كل Index يبدأ بـ `tenant_id`.
- ⚠️ اختبارات عزل إلزامية.
