import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES, LOT_MANUAL_STATUSES } from "@pharmacore/domain";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { InventoryService } from "./inventory.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intStr = z.string().regex(/^-?\d+$/);
const Receive = z.object({
  itemId: z.string().uuid(), locationId: z.string().uuid(), unitId: z.string().uuid(), qtyInUnit: z.number().int().positive(), lotNumber: z.string().min(1).max(50),
  expiryDate: isoDate.nullable().optional(), unitCostMinor: z.string().regex(/^\d+$/), costCurrency: z.enum(CURRENCY_CODES), rateScaled: z.string().regex(/^\d+$/).optional(),
  supplierId: z.string().uuid().optional(), sourceType: z.enum(["OFFICIAL", "PARALLEL"]).optional(), printedPublicPriceMinor: z.string().regex(/^\d+$/).nullable().optional(),
  businessDate: isoDate.optional(), movementType: z.enum(["OPENING", "RECEIPT"]).optional(), documentType: z.string().max(40).optional(), documentId: z.string().uuid().optional(),
});
const Fefo = z.object({ itemId: z.string().uuid(), locationId: z.string().uuid(), qtySsu: z.string().regex(/^\d+$/), businessDate: isoDate.optional(), overrideLotId: z.string().uuid().optional(), override: z.object({ approvedBy: z.string().min(1), reason: z.string().min(1) }).optional() });
const Status = z.object({ status: z.enum(LOT_MANUAL_STATUSES), reason: z.string().min(2).max(500), businessDate: isoDate.optional() });
const Adjust = z.object({ lotId: z.string().uuid(), locationId: z.string().uuid(), qtyDeltaSsu: intStr, reason: z.string().min(2).max(500), businessDate: isoDate.optional(), movementType: z.enum(["ADJUSTMENT", "STOCKTAKE"]).optional() });
const Transfer = z.object({ lotId: z.string().uuid(), fromLocationId: z.string().uuid(), toLocationId: z.string().uuid(), qtySsu: z.string().regex(/^\d+$/), businessDate: isoDate.optional(), reason: z.string().max(500).optional() });
const Kardex = z.object({ lotId: z.string().uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });

@Controller("inventory")
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly svc: InventoryService) {}

  @Post("receipts") @RequirePermissions("goods_receipts.post")
  receive(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.receive(me.tenantId, me.userId, parse(Receive, body)); }

  @Get("items/:itemId/balances") @RequirePermissions("stock.read")
  balances(@CurrentUser() me: Principal, @Param("itemId") itemId: string, @Query("businessDate") d?: string) { return this.svc.balances(me.tenantId, itemId, d); }

  @Get("items/:itemId/kardex") @RequirePermissions("stock.read")
  kardex(@CurrentUser() me: Principal, @Param("itemId") itemId: string, @Query() q: unknown) { return this.svc.kardex(me.tenantId, itemId, parse(Kardex, q)); }

  @Post("fefo-preview") @HttpCode(200) @RequirePermissions("stock.read")
  fefo(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.fefoPreview(me.tenantId, parse(Fefo, body)); }

  @Post("lots/:lotId/status") @RequirePermissions("lots.status_change")
  status(@CurrentUser() me: Principal, @Param("lotId") lotId: string, @Body() body: unknown) { return this.svc.setLotStatus(me.tenantId, me.userId, lotId, parse(Status, body)); }

  @Post("adjustments") @RequirePermissions("stock.adjust")
  adjust(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.adjust(me.tenantId, me.userId, parse(Adjust, body)); }

  @Post("transfers") @RequirePermissions("stock.transfer")
  transfer(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.transfer(me.tenantId, me.userId, parse(Transfer, body)); }

  @Get("expiry") @RequirePermissions("expiry.read")
  expiry(@CurrentUser() me: Principal, @Query("businessDate") d?: string) { return this.svc.expiry(me.tenantId, d); }

  @Get("locations") @RequirePermissions("stock.read")
  locations(@CurrentUser() me: Principal) { return this.svc.locations(me.tenantId); }
}
