# مصفوفة التتبع (Traceability Matrix)

> من مصدر المتطلب (محادثات/بحث) → المتطلب في SRS → السياق المعماري → طريقة التحقق. تُحدَّث عند كل تغيير في SRS أو عند إضافة اختبارات.

## 1. من المحادثات (CH) إلى SRS
| مصدر | الوصف المختصر | متطلبات SRS | Bounded Context |
|---|---|---|---|
| CH-F01 | المبيعات، فاتورة، مرتجع | FR-SAL-001..015 | Sales |
| CH-F02 | المشتريات، موردين، مرتجع | FR-PUR-001..008 | Purchasing |
| CH-F03 | الحسابات، إيرادات، مصروفات، ديون | FR-ACC-001..010, FR-SAL-003/012, FR-PUR-005 | Accounting, Sales, Purchasing |
| CH-F04 | الرقابة المحاسبية، قيود، تتبع تعديلات | FR-ACC-002/006/009, FR-IAM-003 | Accounting, Identity/Audit |
| CH-F05 | الجرد المرن | FR-STK-001..005 | Stocktake |
| CH-F06 | المخزون: كميات، صلاحية، تكلفة | FR-INV-001..013, FR-CAT-001 | Inventory, Catalog |
| CH-F07 | التقارير + طباعة | FR-RPT-001..005, FR-ACC-007 | Reporting |
| CH-F08 | بحث سريع + فلاتر | FR-CAT-005, FR-INV-012, FR-RPT-003 | Catalog, Reporting |
| CH-F09 | الدفعات بأسعار وتواريخ مختلفة (منصور) | FR-INV-003, FR-PUR-002 | Inventory |
| CH-F10 | البائع لا يعدل | FR-SAL-006, FR-IAM-002 | Sales, Identity |
| CH-F11 | مخازن | FR-INV-010 | Inventory |
| CH-F12 | إدارة المستخدمين | FR-IAM-001..004 | Identity |
| CH-F13 | ميزات حسب الباقة | FR-LIC-003 | Licensing |
| CH-F14 | ترخيص يمنع النسخ | FR-LIC-001..006 | Licensing |
| CH-F15 | واجهة سهلة | NFR-USE-001..003 | UX |
| CH-N01 | كل عملية تنعكس على المخزون والحسابات | FR-SAL-005, FR-PUR-003, FR-STK-004 | Cross (Domain Events) |
| CH-N02 | منع التعديل بعد الترحيل | FR-SAL-006, FR-PUR-008, FR-ACC-010, NFR-SEC-002 | Cross |
| CH-N03 | NUMERIC لا Float | CON-02 | Data |
| CH-N04 | Immutable Ledger بأصغر وحدة | FR-INV-001/002, CON-03 | Inventory |
| CH-N05 | Stack مقترح | CON-05 → ADR-002 | Architecture |
| CH-N06 | نظام عام لعدة صيدليات | FR-IAM-005, CON-04 → ADR-003 | Identity/Tenancy |
| CH-N07 | مرن قابل للتطوير | NFR-MNT-*, NFR-PORT-* → ADR-001 | Architecture |
| CH-N08 | بسيط الاستخدام، متكامل محاسبياً | NFR-USE-*, FR-ACC-* | — |

## 2. من البحث (R) إلى SRS
| بحث | ما أضافه |
|---|---|
| R1 المنافسون | FR-CAT-006/007 (بدائل، استيراد)، FR-INV-008 (alert_date)، FR-SAL-008 (تعليق)، FR-RPT-001 |
| R3 المعايير | FR-CAT-004 (GS1)، FR-SYS-007 (OpenAPI)، NFR-SEC-004 (ASVS)، NFR-USE-003 (WCAG) |
| R4 اليمن | FR-SAL-009 (استرجاع مسودة)، FR-SAL-011/FR-ACC-008 (عملات)، FR-SAL-013 (ورديات)، FR-RPT-005، FR-SYS-001، NFR-REL-*, NFR-PERF-005 |
| R6 الأنماط | FR-INV-001..007، FR-ACC-002/003/010، FR-INV-011 |
| R7 الترخيص | FR-LIC-001..006 |
| R8 Offline | FR-SYS-001/003، NFR-AVL-001، تصميم UUIDv7/outbox (ADR-004) |
| R9 UX | FR-SAL-001/002/015، NFR-USE-001/002، FR-SYS-005 |

## 3. من SRS إلى التحقق (يُستكمل أثناء التنفيذ)
| FR/NFR | Unit | Integration | E2E | Non-functional | UAT |
|---|---|---|---|---|---|
| FR-INV-004 (FEFO) | `fefo-allocator.spec.ts` | `post-sale.int.spec.ts` | `pos-sale.e2e.ts` | — | UAT-03 |
| FR-INV-005 (لا بيع منتهٍ) | ✓ | ✓ | ✓ | — | UAT-03 |
| FR-INV-007 (سالب) | ✓ | ✓ (DB constraint) | — | — | — |
| FR-SAL-005 (atomic post) | — | ✓ (rollback test) | ✓ | قطع طاقة | UAT-01 |
| FR-SAL-006 (لا تعديل) | — | ✓ (trigger) | ✓ | — | UAT-05 |
| FR-ACC-002 (توازن) | `journal.spec.ts` | ✓ (constraint) | — | — | UAT-07 |
| FR-LIC-001/002 | `license.spec.ts` | — | ✓ (تفعيل أوفلاين) | — | UAT-10 |
| NFR-PERF-001..003 | — | — | — | k6/Playwright timing | — |
| NFR-REL-001 | — | — | — | kill -9 ×20 | — |
| NFR-USE-001 | — | — | — | اختبار 3 مستخدمين | UAT-00 |

> يُنشأ ملف اختبار لكل FR قبل اعتباره "Done" (Definition of Done في `docs/08-quality/`).
