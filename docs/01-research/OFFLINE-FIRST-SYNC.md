# R8 — Offline-First والمزامنة (للمرحلة الحالية والمستقبلية)

> **الهدف:** ضمان أن النظام يعمل 100% بدون إنترنت الآن (جهاز واحد)، ووضع أساس صحيح للمزامنة لاحقاً (فروع متعددة، تطبيق مالك، SaaS) بدون إعادة تصميم.

---

## 1. مستويات Offline (تدرّج حسب المرحلة)

| المستوى | الوصف | المرحلة | التقنية |
|---|---|---|---|
| **L0 — Local Server** | API + DB على جهاز الصيدلية؛ الأجهزة الأخرى في نفس الشبكة المحلية (LAN) تتصل به؛ لا إنترنت مطلوب | **MVP** | Tauri sidecar (Node API + PostgreSQL/SQLite) أو خدمة Windows |
| **L1 — Resilient POS** | شاشة البيع تتحمل انقطاع الاتصال بالخادم المحلي لحظياً (Draft محفوظ في IndexedDB) | MVP | TanStack Query persist + IndexedDB |
| **L2 — Cloud Backup/Mirror** | نسخة احتياطية مشفرة وتقارير للمالك عبر السحابة (أحادي الاتجاه) | MVP+1 | رفع Backup مجدول + ElectricSQL/Read replica أو تقارير مُلخّصة |
| **L3 — Multi-Branch Sync** | فروع متعددة كل منها يعمل محلياً ويزامن ثنائي الاتجاه | Phase 7 | PowerSync أو حل مبني على Event Log |
| **L4 — Mobile Offline** | كاشير جوال يعمل أوفلاين ويزامن | Phase 7 | PowerSync (SQLite على الجوال) |

## 2. مقارنة محركات المزامنة (للمرحلة 7)

| البعد | ElectricSQL | PowerSync | Replicache / Zero | حل ذاتي (Event Log) |
|---|---|---|---|---|
| الاتجاه | خادم → عميل فقط (القراءة) | **ثنائي** | ثنائي | ثنائي |
| العميل | ذاكرة/PGlite | **SQLite كامل** | IndexedDB (ويب فقط) | ما نختاره |
| الكتابة | عبر API الخاص بك | Upload queue → API الخاص بك | Mutators → API | Outbox → API |
| تعارضات | — | يقررها Backend الخاص بك | Rebase تلقائي | نقررها نحن |
| المنصات | ويب، Elixir | **ويب، RN، Flutter، Swift، Kotlin** | ويب فقط | أي |
| قاعدة الخادم | Postgres فقط | Postgres, MongoDB, MySQL | أي | Postgres |
| التشغيل | خدمة Docker | خدمة Docker أو Cloud | لا شيء (أنت تبني) | أنت تبني |
| النضج | جيد | **جيد، إنتاجي في Retail/Logistics** | Replicache صيانة فقط؛ Zero جديد | — |
| الترخيص | Apache 2.0 | Open Edition مجاني؛ Cloud من 49$/شهر | مفتوح | — |

**الاستنتاج:** [1][2]
- **PowerSync** هو الأنسب لنموذجنا (SQLite محلي كامل + Postgres مركزي + جوال). نبقيه كخيار المرحلة 7.
- **ElectricSQL** ممتاز لـ L2 (لوحة مالك للقراءة الحية).
- **لا نلتزم بأي منهما الآن** — لكن نصمم البيانات بحيث تناسبهما.

## 3. متطلبات التصميم الآن لتسهيل المزامنة لاحقاً (Sync-Ready Design)
هذه قرارات **رخيصة الآن، مكلفة لاحقاً**:

| القرار | السبب |
|---|---|
| **UUID v7** كمفاتيح أساسية (لا auto-increment) | إنشاء معرّفات في عدة أجهزة بدون تعارض؛ v7 مرتب زمنياً للأداء |
| `tenant_id` + `branch_id` (nullable الآن) في كل جدول أعمال | Partitioning للمزامنة لاحقاً (PowerSync buckets) |
| `created_at`, `updated_at`, `deleted_at` (soft delete) + `version` INTEGER | كشف التغييرات + تعارضات |
| **Ledgers append-only** (مخزون + محاسبة) | الأحداث قابلة للإعادة والدمج بدون تعارض (الجمع تبادلي) — أسهل بكثير من مزامنة "رصيد" |
| **Idempotency key** في كل مستند | منع الترحيل المزدوج عند إعادة الإرسال |
| **Domain Events** مخزنة في جدول `outbox` | Transactional Outbox pattern → يمكن دفعها لأي محرك مزامنة أو Webhook |
| الأرصدة **Projections** قابلة لإعادة البناء | بعد الدمج نعيد بناءها محلياً |
| الوقت بـ UTC + `device_id` | ترتيب الأحداث وتتبع المصدر |
| **لا منطق يعتمد على "الرصيد الحالي" إلا داخل Transaction مقفلة** | في الفروع: كل فرع يملك مخزونه (`location_id`)؛ لا تعارض على نفس الصف |

## 4. استراتيجية التعارضات (مبدئياً للمرحلة 7)
| نوع البيانات | الاستراتيجية |
|---|---|
| Ledgers (حركات، قيود) | **Append — لا تعارض** (الجمع تبادلي) |
| المستندات المرحّلة | غير قابلة للتعديل → لا تعارض |
| البيانات المرجعية (أصناف، أسعار) | Last-Write-Wins مع `version` + سجل تدقيق؛ الأسعار تُدار مركزياً |
| المخزون بين الفروع | كل فرع `location_id` خاص؛ التحويلات مستندات ثنائية (Out ثم In) |
| ترقيم الفواتير | بادئة الفرع (`A-000123`) لمنع التكرار |

## 5. النسخ الاحتياطي (جزء من Offline Resilience)
| البند | التصميم |
|---|---|
| محلي تلقائي | يومي (قابل للتهيئة) + قبل كل تحديث؛ `pg_dump`/نسخ ملف SQLite أثناء WAL checkpoint |
| تشفير | AES-256-GCM بمفتاح مشتق من كلمة سر المالك (Argon2id) |
| وجهات | مجلد محلي + USB + (اختياري) Google Drive/S3-compatible/خادمنا |
| الاحتفاظ | 7 يومية + 4 أسبوعية + 12 شهرية (GFS) |
| الاستعادة | من داخل التطبيق بخطوة واحدة؛ اختبار استعادة شهري موصى به |
| التحقق | checksum SHA-256 لكل نسخة |

## 6. تحمّل انقطاع الكهرباء (Crash Safety)
- PostgreSQL: `synchronous_commit = on` (افتراضي)، `fsync = on`.
- SQLite: `journal_mode = WAL`, `synchronous = FULL`.
- كل ترحيل في Transaction واحدة؛ لا حالة وسيطة.
- الواجهة تحفظ Draft كل تغيير (debounce 500ms) في IndexedDB وتستعيده عند الفتح.
- دليل التركيب: UPS صغير للجهاز والطابعة إلزامي عملياً.

## 7. ما يُنقل
→ ADR-004 (Offline-first & Sync-ready design)
→ `docs/05-data/DATA-MODEL.md` (UUID v7, tenant/branch, version, outbox)
→ `docs/09-delivery/BACKUP-AND-RECOVERY.md`

## المصادر
1. QueryPlane — ElectricSQL vs PowerSync vs Replicache (2026): https://queryplane.com/blog/electricsql-vs-powersync-vs-replicache/
2. Kanopy Labs — Electric vs PowerSync vs LiveStore benchmarks (2026): https://kanopylabs.com/blog/electric-sql-vs-powersync-vs-livestore-local-first
3. Local-first principles (Ink & Switch / wal.sh summary): https://wal.sh/research/local-first
4. Transactional Outbox pattern — microservices.io: https://microservices.io/patterns/data/transactional-outbox.html
5. UUID v7 RFC 9562: https://www.rfc-editor.org/rfc/rfc9562
