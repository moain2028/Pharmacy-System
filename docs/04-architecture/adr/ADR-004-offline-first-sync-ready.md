# ADR-004: Offline-first + Sync-ready Data Design

- **الحالة:** Accepted — 2026-11-03
- **القرار المرتبط:** D-017
- **المتطلبات:** NFR-AVL-001، NFR-REL-*، FR-SAL-009، FR-SYS-001
- **البحث:** R4، R8

## السياق
الكهرباء والإنترنت في اليمن غير مستقرين. أي اعتماد على السحابة يوقف الصيدلية. وفي الوقت نفسه نريد لاحقاً فروعاً ولوحة مالك وSaaS.

## القرار
1. **L0 Local Server:** API + DB على جهاز الصيدلية؛ لا طلب شبكي خارجي في أي مسار حرج.
2. **L1 Resilient UI:** مسودات POS في IndexedDB؛ TanStack Query persist؛ PWA assets.
3. **Crash safety:** Transaction لكل ترحيل؛ `synchronous_commit=on` / SQLite `synchronous=FULL` + WAL.
4. **Sync-ready الآن (رخيص):** UUID v7 (ADR-010)، `tenant_id/location_id`، `version`، `created_at/updated_at` UTC، `device_id`، Idempotency key، Ledgers append-only، Transactional Outbox (ADR-011)، Projections قابلة لإعادة البناء.
5. **محرك المزامنة يُختار في المرحلة 7** (المرشح: PowerSync؛ ElectricSQL للقراءة الحية) — لا التزام الآن.
6. النسخ الاحتياطي التلقائي المشفر جزء من الـ MVP.

## البدائل المرفوضة
- Cloud-only / Firebase: يناقض الواقع المحلي والملكية.
- CRDTs كاملة الآن: تعقيد غير مبرر؛ الـ Ledgers التبادلية تغني عن أغلبه.

## النتائج
- ✅ يعمل 100% بدون إنترنت.
- ✅ المزامنة لاحقاً إضافة Adapter لا إعادة تصميم.
- ⚠️ ترقيم الفواتير لكل موقع ببادئة لتجنب التعارض مستقبلاً.
