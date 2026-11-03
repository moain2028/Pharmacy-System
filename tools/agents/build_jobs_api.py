#!/usr/bin/env python3
"""Builds .tmp_agents/jobs_api1.json — five parallel API-module jobs with exact repo context."""
import json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parents[2]
def rd(p): return (R / p).read_text(encoding="utf-8")
def file_block(p): return f"// ==== FILE: {p} ====\n{rd(p)}\n"
DDL = rd("packages/db/migrations/0001_foundation.sql")
def ddl_tables(*names):
    out = []
    for n in names:
        m = re.search(rf"^CREATE TABLE {n} \(.*?^\);", DDL, re.S | re.M)
        if not m: raise SystemExit(f"table {n} not found")
        out.append(m.group(0))
    return "\n".join(out)
ENUMS = "\n".join(l for l in DDL.splitlines() if l.startswith("CREATE TYPE"))
FUNCS = "\n".join(re.findall(r"CREATE OR REPLACE FUNCTION next_document_number.*?\$\$;", DDL, re.S))

SYSTEM = """You are a principal backend engineer (NestJS 10 on Fastify, PostgreSQL 16, DDD, 20+ years). You write production code for PharmaCore, a pharmacy management system (Yemen; currencies YER_OLD/YER_NEW/SAR/USD; Arabic+English).
OUTPUT FORMAT — STRICT: respond with ONE JSON object only (no prose, no markdown fences):
{"files":[{"path":"<repo-relative path>","content":"<full file content>"}],"notes":"<≤200 words for the integrator>"}
Escape file contents correctly as JSON strings. Keep total output under 24,000 tokens: prefer dense, correct code over comments; do NOT re-emit files you were given.
HARD RULES (violations are rejected automatically by tsc/eslint/vitest):
- TypeScript strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes (use `x?: T | undefined` for optional props you assign undefined to), verbatimModuleSyntax (`import type` for types), NodeNext ESM: relative imports end with `.js`.
- Money ONLY via domain `Money` (bigint minor). Quantities are bigint SSU. Percentages are basis points. Never float for money. Serialize bigint/Money with the provided `J()`.
- DI: every constructor parameter MUST have an explicit `@Inject(Token)` (no decorator metadata under vitest/esbuild). Services are `@Injectable()`; controllers use `@Controller()` with full paths in method decorators like the given SalesController; guard decorators `@RequirePermissions("resource.action")` with permissions ONLY from the catalogue given; `@CurrentUser() me: Principal`.
- ALL tenant data access goes through `this.db.tx(tenantId, async (tx) => {...})` (sets RLS tenant). One business operation = ONE transaction. Use postgres.js tagged templates (`tx\\`SELECT ...\\``), `tx.json(...)` for jsonb, `${x}::enum_type` casts where needed. Rows: bigint columns come back as strings → `BigInt(row.col)`; `date` columns come back as ISO strings; timestamptz as Date.
- Validation with zod `parse(Schema, body)` from shared/validation. Business failures: throw `ApiError.*` (shared/errors) or rethrow DomainError (`if (!r.ok) throw r.error` → mapped to 422). Never swallow errors.
- Reuse the domain aggregates/posting rules given to you; do NOT re-implement business math in the API. Journal entries are persisted with `persistEntry(tx, tenantId, entry, businessDate, actorId)`. Posted documents are immutable (DB trigger); write all rows in the posting transaction, then `audit_log`.
- Numbering: `SELECT next_document_number(${tenantId}, '<SERIES>', '') AS n` (series exist: SALES_INVOICE, SALES_RETURN, PURCHASE_ORDER, GOODS_RECEIPT, SUPPLIER_INVOICE, PURCHASE_RETURN, PAYMENT, EXPENSE, STOCKTAKE, ADJUSTMENT, JOURNAL).
- Tests: Vitest E2E in apps/api/test/<name>.e2e.test.ts using `bootTestApp()` + `c.call(method, url, body)` (url WITHOUT /api/v1 prefix; owner has all permissions). Tests must assert exact money strings, DB rows via `connect(DATABASE_URL,1)` where valuable (journal balance: Σdebit = Σcredit; lines by account_code), and error codes. Dates: use fixed ISO dates in 2026. Expect 201 for POST creates, 200 for `@HttpCode(200)` actions, 409 for conflicts, 422 for domain rule failures, 403 for permission.
- Performance: no N+1 inside loops when a single query with `= ANY(${tx.array(ids)})` or `IN` works; index-friendly WHERE; keep transactions short.
- Arabic/English: names stored as given; no translation logic in API.
THINK DEEPLY before writing: reconcile column names with the DDL given, method signatures with the domain source given, and HTTP codes with the rules above. Correctness > quantity."""

CONV = "\n".join([file_block("apps/api/src/shared/errors.ts"), file_block("apps/api/src/shared/validation.ts"), file_block("apps/api/src/shared/journal.ts"),
  file_block("apps/api/src/infra/db.ts"), file_block("apps/api/src/identity/auth.guard.ts"), file_block("apps/api/test/helpers.ts")])
PERMS = rd("apps/api/src/identity/permissions.ts").split("export type Permission")[0]
CTRL_PATTERN = rd("apps/api/src/sales/sales.controller.ts")
SETUP_NOTES = """## Setup facts (already seeded by /setup/initialize in tests)
- tenants: base_currency (YER_NEW in tests), settings jsonb, discount_posting ('NET'|'GROSS'), official_price_policy.
- Chart of accounts seeded from domain DEFAULT_CHART + extras; postable codes include 1100/1110/1200/1210 cash per currency, 1250 bank, 1260 wallet, 1300 AR, 1400 inventory, 1500 input VAT, 2100 AP, 2150 GRNI, 2200 output VAT, 2300 customer deposits, 3100 capital, 3200 drawings, 4100 sales, 4110 sales returns, 4120 discounts, 4200 FX gain, 4300 other income, 5100 COGS, 5150 purchase price variance, 5200 expiry write-off, 5250 purchase return loss, 5300 shrinkage, 5400 FX loss, 5510 electricity, 5520 rent, 5530 other expenses (cash short), 5540 salaries, 5550 bank fees, 5560 maintenance, 5570 telecom, 5580 transport, 5590 fees.
- expense_categories seeded with codes mapping to 55xx accounts (e.g. 'ELECTRICITY'→5510, 'RENT'→5520). cashboxes seeded: REG1 (REGISTER), SAFE (SAFE). locations: MAIN. price_lists: RETAIL. customers: a walk-in customer (is_walk_in = true). Owner user 'owner' has permission '*'.
- Existing endpoints you can call in tests: POST /items (see panadol() helper → returns {id}; GET /items/:id → units[] with name_en Box/Strip/Tablet/Carton), POST /prices {priceListId,itemId,unitId,unitPriceMinor,minPriceMinor?}, GET /price-lists, POST /exchange-rates {from,to,buyRateScaled,sellRateScaled,effectiveFrom}, POST /inventory/receipts {itemId,locationId,unitId,qtyInUnit,lotNumber,expiryDate,unitCostMinor,costCurrency,businessDate} → {lotId}, GET /inventory/locations, GET /inventory/items/:itemId/balances, GET /cash/balances (rows: id, code, currency, balance_minor), POST /shifts/open {cashboxId, openingFloat:[{currency,amountMinor}]} → {id}, POST /sales {lines:[{itemId,unitId,qtyInUnit}], tenders:[{method:'CASH',currency,amountMinor}], customerId?} → {id, number, totals, settlement}, GET /sales/:id → {invoice, lines, lots, payments}, GET /shifts/:id/x-report.
- RATE_SCALE = 1_000_000 (rate 1 SAR = 140 YER_NEW → rateScaled 140000000)."""

def job(id_, model, user, max_tokens=26000):
    return {"id": id_, "model": model, "system": SYSTEM, "user": user, "out": f".tmp_agents/{id_}.json", "max_tokens": max_tokens}

jobs = []
# ---------------- D1 Customers + Sales Returns
jobs.append(job("D1-customers-returns", "claude-opus-5-5", f"""# Task D1 — Customers CRUD + Sales Returns API
Produce EXACTLY these files:
1. apps/api/src/customers/customers.service.ts + apps/api/src/customers/customers.controller.ts — routes: GET customers (q search by code/name/phone, limit/offset), GET customers/:id (with balance: Σ AR journal lines dim_customer_id debit−credit in base), POST customers (code auto 'C-'+zero-padded count if omitted; price_list_id optional; credit_limit_minor + credit_currency), PATCH customers/:id (optimistic `version`), GET customers/:id/statement?from&to (posted sales_invoices credit_minor>0, sales_returns, party_payments CUSTOMER → running balance). Permissions: customers.read / customers.manage / customers.credit_limit (required when credit_limit_minor changes).
2. apps/api/src/sales/returns.service.ts — `ReturnsService` with `quote(tenantId, actor, req)` and `post(tenantId, actor, req)` and `get`, `list`. Request: {{ invoiceId, lines:[{{lineId, qtySsu: string}}], reason:{{code,text?}}, businessDate?, refundToCustomerCredit?, approver?:{{username,secret}} }}. Build `PostedInvoiceSnapshot` from sales_invoices/sales_invoice_lines/sale_line_lots/invoice_payments/items.is_returnable/lots(expiry_date, manual_status) — returnedQtySsu per line & per lot from POSTED sales_return_lines (original_line_id, lot_id). Permissions passed to the domain = actor's permission set (plus approver's if `approver` given and verified via `AuthService.elevate(tenantId, approver, 'returns.post')`). Policy: defaultReturnWindowDays from tenants.settings.return_window_days (default 7). Posting (one tx, FOR UPDATE on invoice): requires an OPEN shift of the actor when any CASH refund; insert sales_returns (number SALES_RETURN series, status POSTED, refund_total_minor, shift_id, cashier_id, customer_id, currency, business_date, reason, approved_by, posted_at/by), sales_return_lines (unit_id/factor_snapshot/qty_in_unit = original line's unit; ssu_qty; refund_unit_price_minor = refund/qty floor; refund_minor; cost_minor_snapshot; lot_id per lot intent — one row per lot intent), stock_movements SALE_RETURN (+qty, same location as the sale_line_lot, unit_cost_minor_snapshot = cost/qty, document_type 'SALES_RETURN'), lot destination: QUARANTINED/BLOCKED → UPDATE lots.manual_status (+status_reason) only if currently 'NONE'; cash refund → cash_movements kind 'SALE_REFUND' NEGATIVE amount (currency = invoice currency) on the shift cashbox; CUSTOMER_CREDIT/CREDIT refunds → no cash. Journal: `salesReturnPosted(meta, {{returnId, originalInvoiceId, customerId, returnedNet: toBase(refundTotal − vat share), outputVat: toBase(vat share), refunds: PaymentPart[] for CASH/CARD/WALLET only (via kind CASH→cashbox id, CARD→'BANK', WALLET→'WALLET'), restock: intent.lotCosts}})`. VAT share = Σ per returned line of original line tax_minor × qty/line qty (Half-Up); when tax_bp = 0 it's zero. Then audit_log 'returns.post'.
3. apps/api/test/returns.e2e.test.ts — scenario: panadol item, prices box 1500.00/strip 750.00, receipt lot A 2 boxes @1200.00 exp 2026-04-01 and lot B 10 boxes @1200.00 exp 2027-01-01, open shift REG1 float 5000.00, sell 3 boxes cash (FEFO → 2 from A + 1 from B) and 1 strip; then: (a) return 1 box (24 SSU) → refund 1500.00, SALE_RETURN movement on lot B (last allocated first), cash_movements SALE_REFUND −150000, journal: Dr 4110 150000 / Cr 1100 150000, Dr 1400 120000 / Cr 5100 120000, balanced; (b) returning 3 more boxes → 422 return.qty_exceeds_returnable; (c) return after window (businessDate 2026-03-20 with sale on 2026-03-01, window 7) → 422 return.window_expired; (d) customer create/patch/get statement works and credit_limit change without customers.credit_limit permission by a cashier user → 403 (create a cashier via POST /users {{username,displayName,password,roleCodes:['CASHIER']}} then login).
Also add these routes to a NEW controller apps/api/src/sales/returns.controller.ts: POST returns/quote (200, returns.create), POST returns (returns.create + returns.post), GET returns, GET returns/:id. I (integrator) will register providers in modules — just export classes.

## Domain source — sales-return.ts (use exactly)
{file_block("packages/domain/src/sales/sales-return.ts")}
## Posting rule (salesReturnPosted) + common types
{file_block("packages/domain/src/accounting/posting-rules-sales.ts")}
{file_block("packages/domain/src/accounting/posting-common.ts")}
## DDL (relevant)
{ENUMS}
{ddl_tables("customers","sales_invoices","sales_invoice_lines","sale_line_lots","invoice_payments","sales_returns","sales_return_lines","stock_movements","lots","cash_movements","shifts","journal_entries","journal_lines","audit_log")}
## API conventions (existing files — import from them)
{CONV}
## Existing controller pattern (SalesController) — follow its style
{CTRL_PATTERN}
## AuthService.elevate signature
`elevate(tenantId: string, approver: {{ username: string; secret: string }}, permission: string): Promise<{{ approverId: string }}>` and `loadAccess(tx, userId): Promise<EffectiveAccess>` (permissions: ReadonlySet<string>). Import {{ AuthService }} from "../identity/auth.service.js".
## Permission catalogue
{PERMS}
{SETUP_NOTES}
"""))
# ---------------- D2 Suppliers + PO + GRN
jobs.append(job("D2-suppliers-po-grn", "claude-fable-5-1", f"""# Task D2 — Suppliers CRUD + Purchase Orders + Goods Receipts API
Produce EXACTLY these files:
1. apps/api/src/purchasing/suppliers.service.ts (+ routes inside purchasing.controller.ts below): GET suppliers (q, limit/offset), GET suppliers/:id (with AP balance from journal_lines dim_supplier_id credit−debit on account 2100 in base), POST suppliers (code auto 'S-'+count), PATCH suppliers/:id (version). Permissions suppliers.read/suppliers.manage.
2. apps/api/src/purchasing/purchasing.service.ts — PurchaseOrders: create (DRAFT) from {{supplierId, currency, expectedDate?, lines:[{{itemId, unitId, qtyInUnit, unitCostMinor, discount?:{{bp}}|{{amountMinor}}, bonusQtyInUnit?}}], invoiceDiscount?, notes?}} using domain `PurchaseOrder` for validation/totals (map rows to its inputs; permissions from actor; approval policy from tenants.settings.po_max_amount_minor if present) → insert purchase_orders + purchase_order_lines; `approve/post` (POSTED or PENDING_APPROVAL→POSTED with purchase_orders.approve); `get`, `list`; `suggestReorder(itemId)` via domain `suggestReorder`. GoodsReceipts: `post` from {{supplierId, purchaseOrderId?, locationId, currency, invoiceRef?, businessDate?, lines:[{{poLineId?, itemId, unitId, qtyInUnit, bonusQtyInUnit?, unitCostMinor, lotNumber, expiryDate, printedPublicPriceMinor?, sourceType?}}], landedCosts?:[{{type, amountMinor, currency}}], bonusCostPolicy?}} — use domain `GoodsReceipt` (create → post with options; accounts grni='2150', ap='2100'; base currency from tenant; rate via `rateFor` when currency ≠ base) — one tx: insert goods_receipts + goods_receipt_lines, ONE NEW LOT per line (lots: qty_received_ssu incl. bonus, total_cost_minor in BASE from domain line cost, cost_currency = base, supplier_id, source_type, printed_public_price_minor, source_document_type 'GOODS_RECEIPT'), stock_movements RECEIPT (+ssu, unit_cost_minor_snapshot, document_type 'GOODS_RECEIPT', unit_id), update purchase_order_lines.received_ssu and purchase_orders.status via domain `receive` when PO given, journal via `purchaseReceiptPosted` (accrual 'GRNI'), audit_log. Return warnings (SHORT_SHELF_LIFE / PUBLIC_PRICE_MISMATCH) from the domain. `get`, `list`.
3. apps/api/src/purchasing/purchasing.controller.ts — routes: suppliers (above), POST purchase-orders (201), POST purchase-orders/:id/approve (200), GET purchase-orders, GET purchase-orders/:id, GET purchase-orders/reorder-suggestions?itemId, POST goods-receipts (201, goods_receipts.post), GET goods-receipts, GET goods-receipts/:id. Zod schemas inline.
4. apps/api/test/purchasing.e2e.test.ts — supplier create → PO 10 cartons panadol @ 24,000.00 per carton (= 240 SSU → cost 100.00/SSU) with 1 bonus carton → approve → GRN 10+1 cartons lot 'P-2027' exp 2027-06-30 → assert: one lot with qty_received_ssu 2640, total_cost_minor 24,000,000 (bonus spreads cost), stock balance 2640 SSU, journal Dr 1400 24,000,000 / Cr 2150 24,000,000 balanced; PO status RECEIVED; GRN in SAR (rate 140) converts cost to base; GRN with expiry 2026-03-10 near businessDate 2026-03-01 returns SHORT_SHELF_LIFE warning; PATCH supplier wrong version → 409.
I (integrator) register the module. Export classes only.

## Domain source — purchase-order.ts
{file_block("packages/domain/src/purchasing/purchase-order.ts")}
## Domain source — goods-receipt.ts
{file_block("packages/domain/src/purchasing/goods-receipt.ts")}
## Posting rules purchasing (+ common)
{file_block("packages/domain/src/accounting/posting-rules-purchasing.ts")}
{file_block("packages/domain/src/accounting/posting-common.ts")}
## DDL (relevant)
{ENUMS}
{ddl_tables("suppliers","items","item_units","purchase_orders","purchase_order_lines","goods_receipts","goods_receipt_lines","lots","stock_movements","journal_entries","journal_lines","audit_log")}
## API conventions
{CONV}
## Existing controller pattern
{CTRL_PATTERN}
## Permission catalogue
{PERMS}
{SETUP_NOTES}
"""))
# ---------------- D3 Supplier invoice + purchase return + supplier payments
jobs.append(job("D3-supplier-invoice-return-pay", "gpt-6-astra", f"""# Task D3 — Supplier Invoices (3-way match) + Purchase Returns + Supplier Payments API
Produce EXACTLY these files:
1. apps/api/src/purchasing/payables.service.ts — `PayablesService`:
   - `postSupplierInvoice(tenantId, actor, req)` req: {{supplierId, supplierInvoiceNo, invoiceDate, currency, dueDate?, lines:[{{grnLineId?, itemId, unitId, qtyInUnit, unitCostMinor, discount?, unmatchedReason?}}], invoiceDiscount?, taxBp?, earlyPayment?:{{days,bp}}, approver?:{{username,secret}}, reason?}} → build domain `SupplierInvoice` inputs (GrnLineRef from goods_receipt_lines joined with goods_receipts: grniBase = line base cost accrued; PO price if purchase_order_lines exists) → post with accounts {{ap:'2100', grni:'2150', priceVariance:'5150', tax:'1500', direct:'1400'}}; OVER_TOLERANCE requires approver elevated for 'purchase.match_override' → approvedBy. Insert supplier_invoices + supplier_invoice_lines, persist entry, audit_log. Uniqueness (supplier_id, supplier_invoice_no) → 409 'supplier_invoices.duplicate_number'. Price variances returned by the domain → also UPDATE nothing on lots (lots facts immutable) — just book variance (already in entry).
   - `postPurchaseReturn(tenantId, actor, req)` req: {{supplierId, locationId, businessDate?, reason (domain enum), lines:[{{lotId, qtySsu, agreedCreditPerSsuMinor?}}]}} → domain `PurchaseReturn` (lots hydrated via `Lot.create`, onHandSsu from stock_balances at location), post with accounts {{ap:'2100', returnLoss:'5250'}} → purchase_returns + purchase_return_lines, stock_movements PURCHASE_RETURN (negative), lots fully returned → manual_status 'RETURNED_TO_SUPPLIER', persist entry, audit.
   - `paySupplier(tenantId, actor, req)` req: {{supplierId, cashboxId, method, currency, amountMinor, businessDate?, allocation:{{mode:'FIFO'|'PRO_RATA'|'EXPLICIT', targets?}}, reference?}} → open items = POSTED supplier_invoices (remaining = total − Σ prior party_payments allocations) and credit notes (purchase_returns) → domain `allocatePayment` (early-payment terms from supplier) → party_payments (party_type SUPPLIER, allocations jsonb [{{documentType, documentId, amountMinor}}], number PAYMENT series, status POSTED) + cash_movements SUPPLIER_PAYMENT (negative; requires actor OPEN shift when cashbox kind REGISTER) + journal `postSupplierPayment` from posting-rules-treasury (payableBase = booked base of settled invoices; discount account '4300' when discount taken) + audit.
   - `supplierLedger(tenantId, supplierId)` → open items + `ageOpenItems` aging; `listInvoices`, `getInvoice`.
2. apps/api/src/purchasing/payables.controller.ts — POST supplier-invoices (201), GET supplier-invoices, GET supplier-invoices/:id, POST purchase-returns (201), POST supplier-payments (201), GET suppliers/:id/ledger. Permissions: supplier_invoices.create+post, purchase_returns.create+post, payables.pay, suppliers.read.
3. apps/api/test/payables.e2e.test.ts — precondition via existing endpoints: supplier + GRN are NOT yet exposed by other agents, so create test data DIRECTLY with SQL (connect(DATABASE_URL,1) then `SET app.tenant_id` is NOT needed for the owner connection — it bypasses RLS) : insert a supplier, a goods_receipt (POSTED) with one goods_receipt_line for a lot created via POST /inventory/receipts (10 boxes @1200.00 = 288,000.00 base, 240 SSU)… simpler: insert goods_receipts/goods_receipt_lines rows referencing that lot with base cost 2,880,000 minor and grni accrued, plus a journal entry is not required for the test. Then: supplier invoice matching the GRN line at 1200.00/box → entry Dr 2150 2,880,000 / Cr 2100 2,880,000; at 1250.00/box → Dr 5150 120,000 variance; duplicate number → 409; purchase return 2 boxes of that lot → Dr 2100 288,000 / Cr 1400 288,000, stock −48 SSU; supplier payment FIFO 1,000,000 → party_payments allocations, cash_movements SUPPLIER_PAYMENT −1,000,000, entry Dr 2100 / Cr 1100 balanced; ledger shows remaining.
I (integrator) register the module. Export classes only.

## Domain — supplier-invoice.ts
{file_block("packages/domain/src/purchasing/supplier-invoice.ts")}
## Domain — purchase-return.ts
{file_block("packages/domain/src/purchasing/purchase-return.ts")}
## Domain — supplier-ledger.ts
{file_block("packages/domain/src/purchasing/supplier-ledger.ts")}
## Posting rules treasury (postSupplierPayment) — signature excerpt
{rd("packages/domain/src/accounting/posting-rules-treasury.ts")[:6500]}
## Lot.create signature (inventory/lot.ts excerpt)
{rd("packages/domain/src/inventory/lot.ts")[:5200]}
## DDL (relevant)
{ENUMS}
{ddl_tables("suppliers","lots","stock_movements","goods_receipts","goods_receipt_lines","purchase_order_lines","supplier_invoices","supplier_invoice_lines","purchase_returns","purchase_return_lines","party_payments","cash_movements","shifts","cashboxes","journal_entries","journal_lines","audit_log")}
## API conventions
{CONV}
## Existing controller pattern
{CTRL_PATTERN}
## Permission catalogue
{PERMS}
{SETUP_NOTES}
"""))
# ---------------- D4 Treasury: receipts, expenses, transfers, fx, opening balances
jobs.append(job("D4-treasury", "claude-opus-5-5", f"""# Task D4 — Treasury API: customer receipts, expenses, cash transfers, FX exchange, owner capital/drawings, opening balances
Produce EXACTLY these files:
1. apps/api/src/treasury/treasury.service.ts — `TreasuryService` (all one-tx, journal via posting-rules-treasury, cash_movements rows with correct kind/sign, audit_log):
   - `customerReceipt(req)` {{customerId, cashboxId, method, currency, amountMinor, businessDate?, allocations?:[{{invoiceId, amountMinor}}], reference?}} → party_payments CUSTOMER (POSTED, number PAYMENT), cash_movements CUSTOMER_PAYMENT (+), journal `postCustomerReceipt` (receivableBase = Σ allocations converted at the invoices' booked base = sales_invoices.credit_minor in invoice currency → base via rateFor when foreign; depositBase = unallocated). Requires actor OPEN shift when cashbox kind REGISTER (shift_id recorded).
   - `expense(req)` {{categoryId, cashboxId|null (null = on credit to supplier? NO — v1: cashbox required), currency, amountMinor, inputVatMinor?, businessDate?, description, approver?}} → expenses (POSTED, number EXPENSE), cash_movements EXPENSE (−), journal `postExpense` (categoryAccountCode from expense_categories.account_code, vatAccountCode '1500', paidFrom FUNDS via cashbox kind: REGISTER/SAFE→CASH, BANK→BANK, WALLET→WALLET).
   - `transfer(req)` {{fromCashboxId, toCashboxId, currency, amountMinor, toCurrency?, toAmountMinor?, businessDate?, reason}} → two cash_movements TRANSFER_OUT (−) / TRANSFER_IN (+) sharing pair_id (uuid), journal `postCashTransfer`.
   - `fxExchange(req)` {{cashboxId, fromCurrency, fromAmountMinor, toCurrency, toAmountMinor, businessDate?}} → FX_OUT (−) / FX_IN (+) with pair_id and rate_scaled_snapshot, journal `postFxExchange` (book rate via rateFor; difference → FX gain/loss as the rule does).
   - `ownerTxn(req)` {{kind:'CAPITAL'|'OWNER_DRAWING', cashboxId, currency, amountMinor, businessDate?, memo}} → cash movement CAPITAL(+)/OWNER_DRAWING(−) + `postCapitalInjection`/`postOwnerDrawing`.
   - `openingBalances(req)` {{businessDate, lines:[{{accountCode, side:'DEBIT'|'CREDIT', amountMinor, currency?, cashboxId?}}]}} → `postOpeningBalances` (balancingAccountCode '3100'); for cash accounts also insert OPENING_FLOAT? NO — use kind 'CAPITAL' cash_movements (+) per cashbox line so cashbox balances match the ledger; only allowed once (settings.opening_posted → 409 'treasury.opening_already_posted'), requires permission journal.manual.
   - `expenseCategories()` list; `cashboxes()` list.
2. apps/api/src/treasury/treasury.controller.ts — POST customer-receipts (201, customers.manage), POST expenses (201, cash.expense), POST cash/transfers (201, cash.move), POST cash/fx (201, cash.fx), POST cash/owner (201, cash.move + journal.manual), POST accounting/opening-balances (201, journal.manual), GET expense-categories (cash.read), GET cashboxes (cash.read).
3. apps/api/test/treasury.e2e.test.ts — open shift REG1 float 5000.00 YER_NEW; expense ELECTRICITY 1200.00 → cash_movements EXPENSE −120000, entry Dr 5510 120000 / Cr 1100 120000; transfer 1000.00 REG1→SAFE → two paired movements, entry Dr 1100(SAFE dim) / Cr 1100(REG1 dim) balanced, GET /cash/balances REG1 = 5000−1200−1000 = 2800.00; fx: give 100 SAR receive 14,000 YER_NEW at rate 140 (book rate buy 140 sell 142 set via POST /exchange-rates) → movements FX_OUT −10000 SAR and FX_IN 1400000 YER_NEW, entry balanced; customer receipt: create customer via SQL insert (customers table) then credit sale is not available → receipt 500.00 with no allocations → deposit: entry Dr 1100 50000 / Cr 2300 50000; opening balances {{1400 DEBIT 1,000,000; 2100 CREDIT 300,000}} → Cr 3100 700,000, second call 409.
I (integrator) register the module. Export classes only.

## Domain — posting-rules-treasury.ts (use exactly)
{file_block("packages/domain/src/accounting/posting-rules-treasury.ts")}
## posting-common.ts
{file_block("packages/domain/src/accounting/posting-common.ts")}
## cash-movement.ts (kinds & signs)
{rd("packages/domain/src/cash/cash-movement.ts")[:4200]}
## DDL (relevant)
{ENUMS}
{ddl_tables("tenants","customers","cashboxes","shifts","cash_movements","party_payments","expense_categories","expenses","journal_entries","journal_lines","audit_log","sales_invoices")}
## API conventions
{CONV}
## Existing controller pattern
{CTRL_PATTERN}
## Permission catalogue
{PERMS}
{SETUP_NOTES}
"""))
# ---------------- D5 Reports
jobs.append(job("D5-reports", "claude-fable-5-1", f"""# Task D5 — Reports API (read-only, SQL-first, fast)
Produce EXACTLY these files:
1. apps/api/src/reports/reports.service.ts — `ReportsService` (every method = ONE read tx; return plain JSON with money as strings in minor units and currency; all filters validated; add `LIMIT` caps):
   - `trialBalance(tenantId, {{to}})` → per account: code, name_ar, name_en, type, debit, credit, balance (from journal_lines joined journal_entries business_date ≤ to and accounts); totals (Σdebit = Σcredit).
   - `profitAndLoss({{from,to}})` → revenue accounts (4xxx) credit−debit, expense accounts (5xxx) debit−credit, grossProfit = sales(4100) − returns(4110) − discounts(4120) − COGS(5100), netProfit.
   - `balanceSheet({{to}})` → assets/liabilities/equity + current-period net profit as retained earnings line; check assets = liabilities + equity.
   - `salesSummary({{from,to,groupBy:'day'|'month'|'cashier'|'item'|'category'}})` → count, gross, discount, net, tax, total, cogs, grossMargin from POSTED sales_invoices(/lines) (and sales_returns subtracted as separate columns).
   - `salesByPaymentMethod({{from,to}})` from invoice_payments.
   - `topItems({{from,to,limit}})` by net.
   - `inventoryValuation({{asOf?}})` → per item: on-hand SSU (stock_movements ≤ asOf), value at lot cost (Σ qty × lot unit cost), by location optional; totals.
   - `expiryReport({{days, asOf}})` → lots with qty>0 expiring within days (buckets: expired, ≤30, ≤90, ≤180) with value.
   - `slowMoving({{days}})` → items with stock but no SALE movement in N days.
   - `customerAging({{asOf}})` / `supplierAging({{asOf}})` → open balances per party in buckets current/1-30/31-60/61-90/90+ based on sales_invoices (credit_minor − receipts allocations) and supplier_invoices (total − payments) due dates.
   - `cashbook({{cashboxId, from, to}})` → cash_movements with running balance per currency.
   - `auditTrail({{from,to,actorId?,action?,limit}})` from audit_log.
   - `dashboard()` → today's sales total/count, open shifts, low-stock count (items.reorder_point if column exists else skip), expiring ≤90 days count, cash on hand per currency.
2. apps/api/src/reports/reports.controller.ts — GET reports/trial-balance, reports/pnl, reports/balance-sheet, reports/sales, reports/sales-by-method, reports/top-items, reports/inventory-valuation, reports/expiry, reports/slow-moving, reports/customer-aging, reports/supplier-aging, reports/cashbook, reports/audit, reports/dashboard. Permissions: reports.financial (TB/P&L/BS/aging), reports.sales, reports.inventory, audit.read, cash.read for cashbook. Zod for query params (dates ISO, coerce numbers).
3. apps/api/test/reports.e2e.test.ts — build data via existing endpoints (item, prices, two receipts, shift open, one cash sale of 3 boxes 1500.00 each + 1 strip 750.00 = 5250.00 total, cogs 3×24×50.00 + 12×50.00 = 4200.00) then assert: trial balance balanced and 1100 debit = 500000+525000; P&L: sales 525000, COGS 420000, grossProfit 105000; inventory valuation = (12 boxes×24 − 84 SSU) × 5000 = 1,020,000 minor… compute carefully from the fixture (receipts: 2 boxes @1200.00 and 10 boxes @1200.00 → cost per SSU 5000 minor); expiry report with days=60 asOf 2026-03-01 lists lot A (exp 2026-04-01) only; sales summary by day returns one row with count 1; dashboard returns cash on hand YER_NEW 1,025,000; unauthorized cashier (POST /users roleCodes ['CASHIER'] then login) → 403 on trial balance.
I (integrator) register the module. Export classes only.

## DDL (full — write correct SQL)
{DDL}
## API conventions
{CONV}
## Existing controller pattern
{CTRL_PATTERN}
## Permission catalogue
{PERMS}
{SETUP_NOTES}
""", 24000))
Path(R / ".tmp_agents/jobs_api1.json").write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
for j in jobs: print(j["id"], j["model"], len(j["user"]) // 4, "tokens≈")

# ---------------- D3 relaunch (corrected fixture + contracts) — only when invoked with "d3"
if len(sys.argv) > 1 and sys.argv[1] == "d3":
    d3 = [j for j in jobs if j["id"].startswith("D3")][0]
    d3["id"] = "D3b-supplier-invoice-return-pay"; d3["out"] = ".tmp_agents/D3b-supplier-invoice-return-pay.json"
    d3["user"] = d3["user"].replace("# Task D3 —", """# Task D3 (revised) —
## ANSWERS TO YOUR QUESTIONS (contracts are now exact — implement, do not ask again)
1. FIXTURE (corrected, base currency YER_NEW, 2 decimals → minor = ×100): lot = 10 boxes × 1,200.00 = 1,200,000 minor base cost, 240 SSU (box factor 24) → unit cost 5,000 minor/SSU. Supplier invoice at 1,200.00/box → Dr 2150 1,200,000 / Cr 2100 1,200,000. At 1,250.00/box → Dr 2150 1,200,000, Dr 5150 50,000 / Cr 2100 1,250,000. Purchase return of 2 boxes (48 SSU) at cost → Dr 2100 240,000 / Cr 1400 240,000, stock −48 SSU. Supplier payment FIFO 1,000,000 against the 1,250,000 invoice → remaining 250,000.
2. Permission string is `supplier_invoices.match_override` (MATCH_OVERRIDE_PERMISSION in the domain file now equals this). Elevation: `const { approverId } = await this.auth.elevate(tenantId, { username, secret }, MATCH_OVERRIDE_PERMISSION)`; AuthService import: `import { AuthService } from "../identity/auth.service.js"`; `loadAccess(tx, userId)` returns `{ permissions: ReadonlySet<string> }`. Owner has every permission.
3. `FundsAccount = { kind: "CASH"|"BANK"|"WALLET"; id: string }`; `DiscountValue = { mode: "PERCENT"; bp: number } | { mode: "AMOUNT"; amount: Money }`. Barrel `@pharmacore/domain` exports everything from supplier-invoice.ts, purchase-return.ts, supplier-ledger.ts, posting-rules-treasury.ts, posting-common.ts, inventory/lot.ts, money. `stock_balances` view: (tenant_id, item_id, lot_id, location_id, qty_ssu) = Σ stock_movements.qty_delta_ssu. `item_units`: id, item_id, name_ar, name_en, factor_to_ssu bigint, level, is_ssu, can_sell, can_purchase.
4. Tolerances: tenants.settings.match_tolerance_qty_bp / match_tolerance_price_bp (default 0 and 200). Uniqueness (supplier_id, supplier_invoice_no): there is NO DB constraint — check with SELECT inside the tx and throw 409 `supplier_invoices.duplicate_number`.
5. Ledger exports are `allocatePayment`, `aging` (not ageOpenItems), `balance`, `dueDateFor`, `addDays`. Use `aging`.
6. Test data: create lot via POST /inventory/receipts (returns {lotId}); then with `const sql = connect(DATABASE_URL, 1)` (owner connection, bypasses RLS) INSERT suppliers (tenant_id, code, name), goods_receipts (tenant_id, number, status 'POSTED', supplier_id, location_id, currency 'YER_NEW', business_date, posted_at now(), created_by owner id from users) and goods_receipt_lines referencing that lot — fill NOT NULL columns per the DDL given; use `c.tenantId` for tenant_id. Open a shift (POST /shifts/open on REG1) before paying from REG1.
""")
    Path(R / ".tmp_agents/jobs_api_d3b.json").write_text(json.dumps([d3], ensure_ascii=False), encoding="utf-8")
    print("D3b written", len(d3["user"]) // 4)
