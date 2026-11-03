import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CASH_MOVEMENT_KINDS, CURRENCY_CODES, TENDER_METHODS } from "@pharmacore/domain";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { SalesService } from "./sales.service.js";
import { ShiftsService } from "./shifts.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intStr = z.string().regex(/^\d+$/);
const MoneyIn = z.object({ currency: z.enum(CURRENCY_CODES), amountMinor: intStr });
const Line = z.object({
  itemId: z.string().uuid(), unitId: z.string().uuid(), qtyInUnit: z.number().int().positive(), unitPriceMinor: intStr.optional(),
  lineDiscountBp: z.number().int().min(0).max(10000).optional(), lineDiscountMinor: intStr.optional(),
  lotOverride: z.object({ lotId: z.string().uuid(), reason: z.string().min(1) }).optional(), note: z.string().max(120).optional(),
});
const Sale = z.object({
  customerId: z.string().uuid().optional(), locationId: z.string().uuid().optional(), currency: z.enum(CURRENCY_CODES).optional(), businessDate: isoDate.optional(),
  lines: z.array(Line).min(1).max(200), invoiceDiscountBp: z.number().int().min(0).max(10000).optional(), invoiceDiscountMinor: intStr.optional(),
  prescription: z.object({ patientName: z.string().min(1), doctorName: z.string().min(1), rxNumber: z.string().min(1), rxDate: isoDate, patientIdNo: z.string().optional() }).optional(),
  tenders: z.array(z.object({ method: z.enum(TENDER_METHODS), currency: z.enum(CURRENCY_CODES), amountMinor: intStr, paymentRef: z.string().max(80).optional(), cashboxId: z.string().uuid().optional() })).default([]),
  changeCurrency: z.enum(CURRENCY_CODES).optional(),
  overrides: z.object({ approverUsername: z.string().min(1), approverSecret: z.string().min(1), reason: z.string().min(1), belowMin: z.boolean().optional(), belowCost: z.boolean().optional(), aboveOfficial: z.boolean().optional(), credit: z.boolean().optional() }).optional(),
  idempotencyKey: z.string().max(80).optional(), notes: z.string().max(500).optional(),
});
const ListQ = z.object({ from: isoDate.optional(), to: isoDate.optional(), customerId: z.string().uuid().optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const OpenShift = z.object({ cashboxId: z.string().uuid(), deviceId: z.string().max(80).optional(), openingFloat: z.array(MoneyIn).default([]), openingReason: z.string().max(200).optional() });
const CloseShift = z.object({ counts: z.array(MoneyIn).min(1), reasons: z.record(z.string()).optional(), approver: z.object({ username: z.string().min(1), secret: z.string().min(1) }).optional() });
const CashMove = z.object({ cashboxId: z.string().uuid(), shiftId: z.string().uuid().optional(), kind: z.enum(CASH_MOVEMENT_KINDS), currency: z.enum(CURRENCY_CODES), amountMinor: z.string().regex(/^-?\d+$/), reason: z.string().min(2).max(300), documentType: z.string().max(40).optional(), documentId: z.string().uuid().optional() });

@Controller()
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService, @Inject(ShiftsService) private readonly shifts: ShiftsService) {}

  @Post("sales/quote") @HttpCode(200) @RequirePermissions("sales.create")
  quote(@CurrentUser() me: Principal, @Body() body: unknown) { return this.sales.quote(me.tenantId, parse(Sale, body)); }

  @Post("sales") @RequirePermissions("sales.create", "sales.post")
  post(@CurrentUser() me: Principal, @Body() body: unknown) { return this.sales.post(me.tenantId, { userId: me.userId, permissions: me.access.permissions, limits: me.access.limits }, parse(Sale, body)); }

  @Get("sales") @RequirePermissions("sales.read")
  list(@CurrentUser() me: Principal, @Query() q: unknown) { return this.sales.list(me.tenantId, parse(ListQ, q)); }

  @Get("sales/:id") @RequirePermissions("sales.read")
  get(@CurrentUser() me: Principal, @Param("id") id: string) { return this.sales.get(me.tenantId, id); }

  @Get("shifts/current") @RequirePermissions("shifts.read")
  current(@CurrentUser() me: Principal) { return this.shifts.current(me.tenantId, me.userId); }

  @Post("shifts/open") @RequirePermissions("shifts.open")
  open(@CurrentUser() me: Principal, @Body() body: unknown) { return this.shifts.open(me.tenantId, me.userId, parse(OpenShift, body)); }

  @Get("shifts/:id/x-report") @RequirePermissions("shifts.read")
  x(@CurrentUser() me: Principal, @Param("id") id: string) { return this.shifts.xReport(me.tenantId, id); }

  @Post("shifts/:id/close") @HttpCode(200) @RequirePermissions("shifts.close")
  close(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) { return this.shifts.close(me.tenantId, me.userId, id, parse(CloseShift, body)); }

  @Post("cash/movements") @RequirePermissions("cash.move")
  cashMove(@CurrentUser() me: Principal, @Body() body: unknown) { return this.shifts.cashMovement(me.tenantId, me.userId, parse(CashMove, body)); }

  @Get("cash/balances") @RequirePermissions("cash.read")
  balances(@CurrentUser() me: Principal) { return this.shifts.cashboxBalances(me.tenantId); }
}
