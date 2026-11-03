import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES } from "@pharmacore/domain";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { TreasuryService } from "./treasury.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const posInt = z.string().regex(/^[1-9]\d{0,17}$/);
const Cur = z.enum(CURRENCY_CODES);
const id = z.string().uuid();

const Receipt = z.object({
  customerId: id, cashboxId: id, method: z.enum(["CASH", "CARD", "WALLET"]).default("CASH"), currency: Cur, amountMinor: posInt,
  businessDate: isoDate.optional(), allocations: z.array(z.object({ invoiceId: id, amountMinor: posInt })).max(200).default([]),
  reference: z.string().max(80).optional(),
});
const Expense = z.object({
  categoryId: id, cashboxId: id, currency: Cur, amountMinor: posInt, inputVatMinor: z.string().regex(/^\d{1,18}$/).optional(),
  businessDate: isoDate.optional(), description: z.string().min(1).max(500), approver: id.optional(),
});
const Transfer = z.object({
  fromCashboxId: id, toCashboxId: id, currency: Cur, amountMinor: posInt, toCurrency: Cur.optional(), toAmountMinor: posInt.optional(),
  businessDate: isoDate.optional(), reason: z.string().min(2).max(300),
});
const Fx = z.object({ cashboxId: id, fromCurrency: Cur, fromAmountMinor: posInt, toCurrency: Cur, toAmountMinor: posInt, businessDate: isoDate.optional() });
const Owner = z.object({ kind: z.enum(["CAPITAL", "OWNER_DRAWING"]), cashboxId: id, currency: Cur, amountMinor: posInt, businessDate: isoDate.optional(), memo: z.string().min(1).max(300) });
const Opening = z.object({
  businessDate: isoDate,
  lines: z.array(z.object({
    accountCode: z.string().min(1).max(20), side: z.enum(["DEBIT", "CREDIT"]), amountMinor: posInt, currency: Cur.optional(), cashboxId: id.optional(),
  })).min(1).max(500),
});

@Controller()
export class TreasuryController {
  constructor(@Inject(TreasuryService) private readonly svc: TreasuryService) {}

  @Post("customer-receipts") @RequirePermissions("customers.manage")
  receipt(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.customerReceipt(me.tenantId, me.userId, parse(Receipt, body)); }

  @Post("expenses") @RequirePermissions("cash.expense")
  expense(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.expense(me.tenantId, me.userId, parse(Expense, body)); }

  @Post("cash/transfers") @RequirePermissions("cash.move")
  transfer(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.transfer(me.tenantId, me.userId, parse(Transfer, body)); }

  @Post("cash/fx") @RequirePermissions("cash.fx")
  fx(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.fxExchange(me.tenantId, me.userId, parse(Fx, body)); }

  @Post("cash/owner") @RequirePermissions("cash.move", "journal.manual")
  owner(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.ownerTxn(me.tenantId, me.userId, parse(Owner, body)); }

  @Post("accounting/opening-balances") @RequirePermissions("journal.manual")
  opening(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.openingBalances(me.tenantId, me.userId, parse(Opening, body)); }

  @Get("expense-categories") @RequirePermissions("cash.read")
  categories(@CurrentUser() me: Principal) { return this.svc.expenseCategories(me.tenantId); }

  @Get("cashboxes") @RequirePermissions("cash.read")
  cashboxes(@CurrentUser() me: Principal) { return this.svc.cashboxes(me.tenantId); }
}
