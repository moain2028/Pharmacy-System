# Architecture Decision Records (ADR)

> صيغة Nygard: Context → Decision → Consequences → Alternatives. الحالات: `Proposed` / `Accepted` / `Superseded by ADR-xxx` / `Deprecated`.
> لا يُحذف ADR أبداً. التغيير = ADR جديد يُشير للقديم.

| # | العنوان | الحالة | التاريخ |
|---|---|---|---|
| [ADR-001](./ADR-001-modular-monolith-hexagonal-ddd.md) | Modular Monolith + Hexagonal + DDD | Accepted | 2026-11-03 |
| [ADR-002](./ADR-002-tech-stack.md) | Tech Stack: TypeScript E2E (NestJS/Prisma/PostgreSQL|SQLite, React/Vite/Tailwind, Tauri 2) | Proposed → بانتظار اعتماد الفريق | 2026-11-03 |
| [ADR-003](./ADR-003-multi-tenancy.md) | Multi-tenancy من اليوم الأول (tenant_id + RLS) | Accepted | 2026-11-03 |
| [ADR-004](./ADR-004-offline-first-sync-ready.md) | Offline-first + Sync-ready data design | Accepted | 2026-11-03 |
| [ADR-005](./ADR-005-inventory-lots-ledger-fefo.md) | المخزون: Lots + Immutable Ledger + FEFO + SSU Integer | Accepted | 2026-11-03 |
| [ADR-006](./ADR-006-document-posting-immutability.md) | المستندات: Draft → Posted غير قابل للتعديل | Accepted | 2026-11-03 |
| [ADR-007](./ADR-007-double-entry-accounting.md) | المحاسبة: قيد مزدوج Immutable + Specific Identification | Accepted | 2026-11-03 |
| [ADR-008](./ADR-008-money-representation.md) | الأموال: BIGINT minor units + currency | Accepted | 2026-11-03 |
| [ADR-009](./ADR-009-licensing.md) | الترخيص: Ed25519 + بصمة جهاز + Offline grace + Feature flags | Accepted | 2026-11-03 |
| [ADR-010](./ADR-010-identifiers-uuidv7.md) | المعرّفات: UUID v7 | Accepted | 2026-11-03 |
| [ADR-011](./ADR-011-events-in-process-outbox.md) | الأحداث: In-process داخل Transaction + Transactional Outbox | Accepted | 2026-11-03 |
| [ADR-012](./ADR-012-single-spa-all-platforms.md) | واجهة React واحدة لكل المنصات (Web/PWA/Tauri/Mobile) | Accepted | 2026-11-03 |
