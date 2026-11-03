import { Controller, Get, Inject, Query } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { ReportsService } from "./reports.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = (): string => new Date().toISOString().slice(0, 10);
const RangeBase = z.object({ from: isoDate.default("1970-01-01"), to: isoDate.default(today) });
const ranged = <T extends z.ZodRawShape>(shape: T) => RangeBase.extend(shape).refine((r) => (r.from ?? "") <= (r.to ?? ""), { message: "from must be <= to", path: ["from"] });
const Range = ranged({});
const To = z.object({ to: isoDate.default(today) });
const AsOf = z.object({ asOf: isoDate.default(today) });
const SalesQ = ranged({ groupBy: z.enum(["day", "month", "cashier", "item", "category"]).default("day") });
const TopQ = ranged({ limit: z.coerce.number().int().min(1).max(200).default(20) });
const ValQ = z.object({ asOf: isoDate.optional(), locationId: z.string().uuid().optional(), byLocation: z.enum(["true", "false"]).default("false").transform((v) => v === "true") });
const ExpiryQ = z.object({ days: z.coerce.number().int().min(0).max(3650).default(90), asOf: isoDate.default(today) });
const SlowQ = z.object({ days: z.coerce.number().int().min(0).max(3650).default(90), asOf: isoDate.default(today) });
const CashbookQ = ranged({ cashboxId: z.string().uuid() });
const AuditQ = ranged({ actorId: z.string().uuid().optional(), action: z.string().min(1).max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });

@Controller()
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get("reports/trial-balance") @RequirePermissions("reports.financial")
  trialBalance(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.trialBalance(me.tenantId, parse(To, q)); }

  @Get("reports/pnl") @RequirePermissions("reports.financial")
  pnl(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.profitAndLoss(me.tenantId, parse(Range, q)); }

  @Get("reports/balance-sheet") @RequirePermissions("reports.financial")
  balanceSheet(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.balanceSheet(me.tenantId, parse(To, q)); }

  @Get("reports/sales") @RequirePermissions("reports.sales")
  sales(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.salesSummary(me.tenantId, parse(SalesQ, q)); }

  @Get("reports/sales-by-method") @RequirePermissions("reports.sales")
  salesByMethod(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.salesByPaymentMethod(me.tenantId, parse(Range, q)); }

  @Get("reports/top-items") @RequirePermissions("reports.sales")
  topItems(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.topItems(me.tenantId, parse(TopQ, q)); }

  @Get("reports/inventory-valuation") @RequirePermissions("reports.inventory")
  valuation(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.inventoryValuation(me.tenantId, parse(ValQ, q)); }

  @Get("reports/expiry") @RequirePermissions("reports.inventory")
  expiry(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.expiryReport(me.tenantId, parse(ExpiryQ, q)); }

  @Get("reports/slow-moving") @RequirePermissions("reports.inventory")
  slowMoving(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.slowMoving(me.tenantId, parse(SlowQ, q)); }

  @Get("reports/customer-aging") @RequirePermissions("reports.financial")
  customerAging(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.customerAging(me.tenantId, parse(AsOf, q)); }

  @Get("reports/supplier-aging") @RequirePermissions("reports.financial")
  supplierAging(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.supplierAging(me.tenantId, parse(AsOf, q)); }

  @Get("reports/cashbook") @RequirePermissions("cash.read")
  cashbook(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.cashbook(me.tenantId, parse(CashbookQ, q)); }

  @Get("reports/audit") @RequirePermissions("audit.read")
  audit(@CurrentUser() me: Principal, @Query() q: unknown) { return this.reports.auditTrail(me.tenantId, parse(AuditQ, q)); }

  @Get("reports/dashboard") @RequirePermissions("reports.sales")
  dashboard(@CurrentUser() me: Principal) { return this.reports.dashboard(me.tenantId); }
}
