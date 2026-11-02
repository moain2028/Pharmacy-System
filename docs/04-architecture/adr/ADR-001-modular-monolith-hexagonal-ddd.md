# ADR-001: Modular Monolith + Hexagonal Architecture + DDD

- **الحالة:** Accepted — 2026-11-03
- **القرار المرتبط:** D-016
- **المتطلبات:** CH-N07 (مرن قابل للتطوير)، NFR-MNT-*, NFR-PORT-*, NFR-SCAL-*

## السياق
نبني منتجاً يبدأ كتطبيق لصيدلية صغيرة بجهاز واحد (بساطة النشر حاسمة) ويجب أن يتطور إلى SaaS متعدد المستأجرين والفروع بدون إعادة كتابة. الفريق صغير ومتنوع الخبرة، ويعتمد على وكلاء AI للتنفيذ — لذا الحدود الواضحة والقواعد الصريحة أهم من المرونة المطلقة.

## القرار
1. **Modular Monolith:** تطبيق NestJS واحد قابل للنشر، مقسّم إلى Modules تطابق الـ Bounded Contexts (Catalog, Inventory, Sales, Purchasing, Accounting, Stocktake, Parties, Reporting, IAM, Licensing, Tenancy, Audit, Notifications, Backup).
2. **Hexagonal داخل كل Module:** `presentation / application / infrastructure` + Domain نقي في `packages/domain`. التبعيات تتجه للداخل فقط.
3. **DDD تكتيكي:** Aggregates مع Invariants صريحة، Value Objects، Domain Events، Repositories كـ Ports.
4. **CQRS-light:** الكتابة عبر Aggregates؛ القراءة (التقارير) عبر Read Models/SQL مباشر.
5. **الحدود مفروضة آلياً:** `eslint-plugin-boundaries` يمنع الاستيراد العابر؛ التواصل بين Modules عبر Domain Events أو Facades معلنة.

## البدائل المرفوضة
| البديل | لماذا لا |
|---|---|
| Microservices من البداية | تعقيد تشغيلي هائل لصيدلية بجهاز واحد؛ فريق صغير؛ لا حاجة للتوسع المستقل الآن |
| Monolith تقليدي (MVC بلا حدود) | يتحول لكرة طين؛ يستحيل تفكيكه لاحقاً؛ يناقض هدف المؤسسة |
| Serverless-first | يناقض Offline-first |

## النتائج
- ✅ نشر بسيط (ملف تنفيذي واحد + DB).
- ✅ اتساق قوي عبر Transaction واحدة بين Sales/Inventory/Accounting.
- ✅ تفكيك لاحق ممكن (كل Module له Public API وأحداث).
- ⚠️ انضباط مطلوب — يُعوَّض بالـ lint والقوالب.
- ⚠️ منحنى تعلم DDD للفريق — يُعوَّض بـ DOMAIN-MODEL.md و GLOSSARY.
