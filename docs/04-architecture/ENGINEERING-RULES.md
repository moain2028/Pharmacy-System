# القواعد الهندسية غير القابلة للتفاوض (Non-Negotiable Engineering Rules)

> **موجّهة لأي مطور أو وكيل AI يكتب كوداً في هذا المستودع.** خرق أي قاعدة = PR مرفوض. تُفرض آلياً حيث أمكن (lint, DB constraints, tests, CI).
> تجمع وثيقة مازن التقنية + قرارات الفريق + المعايير العالمية.

---

## A. الأموال والكميات
| # | القاعدة | الفرض |
|---|---|---|
| A1 | **ممنوع `float`/`double`/`number` للأموال.** تُخزَّن كـ `BIGINT amount_minor` + `currency CHAR(3)`؛ في TS كـ `bigint` داخل `Money` VO. | lint rule (no `number` في حقول `*Minor`)، Prisma `BigInt`، مراجعة |
| A2 | أسعار الصرف `NUMERIC(18,8)`؛ النسب `NUMERIC(7,4)`. | Prisma `Decimal` |
| A3 | التقريب مرة واحدة عند الترحيل بوضع موحّد (`HALF_UP` افتراضياً) ويُحفظ الناتج؛ لا إعادة حساب من الكسور لاحقاً. | `Money.round()` مركزي |
| A4 | **المخزون `INTEGER` بأصغر وحدة بيع (SSU)** في كل مكان داخل Domain/DB. التحويل لوحدات العرض عند الحدود فقط. | Prisma `Int`، `Quantity` VO |
| A5 | توزيع المبالغ (خصم على أسطر، ضريبة) بخوارزمية Largest Remainder بلا فقد سنت. | `Money.allocate()` + unit tests |

## B. السجلات غير القابلة للتعديل (Ledgers)
| # | القاعدة | الفرض |
|---|---|---|
| B1 | `stock_movements`, `journal_entries`, `journal_lines`, `audit_log`, `outbox` = **append-only**. لا UPDATE/DELETE. | **DB Trigger** يرفع استثناء؛ Repository بلا `update/delete`؛ اختبار |
| B2 | الأرصدة (`stock_balances`, `account_balances`) **مشتقة** وقابلة لإعادة البناء من الـ Ledger بأمر واحد. | أمر CLI `rebuild-projections` + اختبار تطابق |
| B3 | كل حركة مخزون لها `reference_type/id` (مستند) أو `reason` (تسوية). | NOT NULL CHECK |
| B4 | `Σ debit = Σ credit` لكل قيد. | Deferred constraint/Trigger + unit test |
| B5 | لا UPDATE/DELETE على مستند بحالة `posted`. التصحيح بمستند جديد (`reversal_of` / `return_of`). | Trigger + Aggregate invariant |

## C. المخزون والدفعات
| # | القاعدة | الفرض |
|---|---|---|
| C1 | كل سطر استلام = **Lot جديد** (حتى بنفس رقم الدفعة) بتكلفته وتاريخه ومصدره. | Domain |
| C2 | الصرف **FEFO** افتراضياً؛ التجاوز يتطلب صلاحية + سبب مسجّل. | `FefoAllocator` + RBAC |
| C3 | لا بيع من دفعة منتهية (`expiry_date ≤ today`). | Domain + DB CHECK عند insert حركة sale |
| C4 | لا رصيد سالب إلا بسياسة صريحة مع تعليم الحركة. | Tx مقفلة `SELECT FOR UPDATE` + CHECK |
| C5 | `COGS` = تكلفة الدفعة الفعلية (Specific Identification). | PostingRules |

## D. المعمارية والحدود
| # | القاعدة | الفرض |
|---|---|---|
| D1 | `packages/domain` **بدون أي تبعية خارجية** (لا Nest/Prisma/React/Node APIs). | `package.json` بلا deps + lint `no-restricted-imports` |
| D2 | Module لا يستورد `application/` أو `infrastructure/` من Module آخر. التواصل عبر Events أو Facade معلنة. | `eslint-plugin-boundaries` |
| D3 | منطق الأعمال في Aggregates/Domain Services فقط. Controllers نحيفة؛ الواجهة بلا منطق أعمال. | مراجعة + اختبارات Domain |
| D4 | كل Use Case = Command/Query واحد بملف واحد مع اختبار. | هيكل مجلدات |
| D5 | الكتابة عبر Unit of Work (Transaction واحدة لكل أمر). | `uow.run()` إلزامي في Handlers |
| D6 | الأحداث تُكتب في `outbox` داخل نفس Transaction. | Handler template |
| D7 | Repositories تُرجع Aggregates كاملة (لا كائنات ORM مسرّبة). | Mappers |
| D8 | لا `any` في TS؛ `strict: true`؛ Zod عند كل حدود إدخال. | tsconfig + lint |

## E. البيانات
| # | القاعدة | الفرض |
|---|---|---|
| E1 | `tenant_id UUID NOT NULL` في كل جدول أعمال + RLS policy في PostgreSQL. | Migration template + اختبار عزل |
| E2 | المفاتيح `UUID v7` تُولَّد في التطبيق (لا autoincrement). | `IdGenerator` port |
| E3 | `created_at, updated_at` UTC، `version INT` للمرجعي، `deleted_at` soft delete للمرجعي فقط (لا للـ Ledgers/المستندات). | Prisma template |
| E4 | أسماء الجداول/الأعمدة `snake_case` إنجليزية؛ الـ Enums نصية صريحة. | Prisma `@@map` |
| E5 | كل Migration قابلة للعكس وموثقة؛ لا تعديل migration مدموجة. | مراجعة |
| E6 | Idempotency key فريد لكل مستند مرحّل. | UNIQUE index |

## F. الأمن
| # | القاعدة | الفرض |
|---|---|---|
| F1 | كلمات المرور Argon2id (m=64MB, t=3, p=4). | مكتبة واحدة |
| F2 | JWT access ≤ 15 دقيقة + refresh بـ httpOnly cookie أو تخزين آمن في Tauri. | Auth module |
| F3 | كل endpoint خلف `AuthGuard + TenantGuard + LicenseGuard + RbacGuard` (ما عدا قائمة بيضاء صريحة). | Global guards + اختبار |
| F4 | لا أسرار في الكود/المستودع؛ `.env` + Tauri secure storage. | gitleaks في CI |
| F5 | التحقق من الإدخال بـ Zod في الحدود؛ الاستعلامات عبر Prisma/معاملات (لا string concat). | lint |
| F6 | النسخ الاحتياطية مشفرة AES-256-GCM. | Backup module |
| F7 | الترخيص يُتحقق في API (Guard) وليس في الواجهة فقط. | — |

## G. الجودة
| # | القاعدة | الفرض |
|---|---|---|
| G1 | تغطية Unit للـ Domain ≥ 80%؛ كل Invariant له اختبار. | Vitest coverage gate في CI |
| G2 | كل Use Case يلمس DB له Integration test (Testcontainers/SQLite in-memory). | CI |
| G3 | المسارات الحرجة (بيع، مرتجع، إقفال، استعادة مسودة، تفعيل ترخيص) لها E2E. | Playwright في CI |
| G4 | CI أخضر إلزامي للدمج: lint, typecheck, test, build. | Branch protection |
| G5 | Conventional Commits؛ PR يذكر FR-xxx/ADR. | commitlint |

## H. الواجهة
| # | القاعدة | الفرض |
|---|---|---|
| H1 | RTL أصلي (`dir="rtl"` + Tailwind logical properties `ms-/me-/ps-/pe-`)؛ لا `left/right` مباشرة. | lint rule |
| H2 | كل عملية POS يومية قابلة للتنفيذ بلوحة المفاتيح؛ الاختصارات من الخريطة الموحدة. | Hotkey registry + E2E |
| H3 | تباين ≥ 4.5:1، focus مرئي، أهداف ≥ 44px. | axe في CI |
| H4 | النصوص من i18n (لا نصوص مضمّنة)؛ المصطلحات من GLOSSARY. | lint `no-literal-strings` (للنصوص الظاهرة) |
| H5 | مسودة POS تُحفظ محلياً كل تغيير. | — |

## I. التوثيق والعمليات
| # | القاعدة | الفرض |
|---|---|---|
| I1 | أي قرار معماري = ADR. | مراجعة |
| I2 | OpenAPI محدّث مع كل تغيير API؛ الأنواع في الواجهة مولّدة منه. | CI diff check |
| I3 | تحديث `docs/00-handoff/*` نهاية كل جلسة. | AGENTS.md |
| I4 | `CHANGELOG.md` عبر Changesets؛ SemVer. | release workflow |
| I5 | كل ميزة لها Feature Flag إن كانت ضمن باقة. | `@RequireFeature` |

---

## قائمة التحقق لكل PR (انسخها في وصف الـ PR)
```
- [ ] FR/ADR المرتبط: ______
- [ ] لا Float للأموال (A1) · المخزون INTEGER SSU (A4)
- [ ] لا UPDATE/DELETE على Ledgers/Posted (B1, B5)
- [ ] Domain بلا تبعيات (D1) · لا استيراد عابر بين Modules (D2)
- [ ] Transaction واحدة + Outbox (D5, D6)
- [ ] tenant_id + UUIDv7 (E1, E2)
- [ ] Guards كاملة (F3) · Zod على الإدخال (F5)
- [ ] اختبارات: Unit/Integration/E2E حسب النوع (G1–G3)
- [ ] RTL + hotkeys + i18n (H1, H2, H4)
- [ ] OpenAPI محدّث (I2) · handoff محدّث (I3)
```
