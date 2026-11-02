# ADR-011: الأحداث — توزيع داخل العملية ضمن Transaction + Transactional Outbox

- **الحالة:** Accepted — 2026-11-03
- **المتطلبات:** CH-N01 (كل عملية تنعكس فوراً)، ADR-004

## السياق
نحتاج اتساقاً قوياً بين Sales/Inventory/Accounting (صيدلية صغيرة لا تحتمل مخزوناً أو حساباً خاطئاً)، وفي الوقت نفسه نريد قابلية التكامل والمزامنة لاحقاً.

## القرار
1. **داخل Transaction:** Handler الأمر يستدعي Facades السياقات الأخرى (Inventory/Accounting/Audit) متزامناً ضمن نفس Unit of Work → نجاح كامل أو rollback كامل.
2. **Outbox:** نفس الأحداث تُكتب في جدول `outbox` داخل Transaction؛ Dispatcher خلفي يوزّعها لاحقاً للمستهلكين غير الحرجين (Notifications، Reporting الثقيلة، Sync، Webhooks) مع `processed_at` و retry.
3. الأحداث مُسلسلة بـ Zod schema وإصدار (`event_version`).

## البدائل المرفوضة
- Eventual consistency بين Sales والمخزون: مرفوض للصيدلية.
- Message broker الآن: تعقيد تشغيلي غير مبرر لجهاز واحد.

## النتائج
- ✅ اتساق قوي + قابلية تكامل.
- ✅ الانتقال لـ broker = تغيير Dispatcher فقط.
