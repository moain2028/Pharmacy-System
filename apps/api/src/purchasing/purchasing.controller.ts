import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES } from "@pharmacore/domain";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { PurchasingService, type Actor } from "./purchasing.service.js";
import { SuppliersService } from "./suppliers.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intStr = z.string().regex(/^\d+$/);
const Discount = z.union([z.object({ bp: z.number().int().min(0).max(10000) }), z.object({ amountMinor: intStr })]);
const Paging = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) };

const Supplier = z.object({
  code: z.string().min(1).max(30).optional(), name: z.string().min(1).max(200), phone: z.string().max(40).optional(), address: z.string().max(300).optional(),
  taxNumber: z.string().max(60).optional(), defaultCurrency: z.enum(CURRENCY_CODES).optional(), paymentTermsDays: z.number().int().min(0).optional(),
  earlyPaymentDays: z.number().int().min(0).optional(), earlyPaymentBp: z.number().int().min(0).max(10000).optional(),
});
const SupplierPatch = Supplier.partial().extend({ version: z.number().int().positive(), isActive: z.boolean().optional() });
const SupplierListQ = z.object({ q: z.string().max(100).optional(), ...Paging });

const PoLine = z.object({
  itemId: z.string().uuid(), unitId: z.string().uuid(), qtyInUnit: z.number().int().positive(), unitCostMinor: intStr, discount: Discount.optional(),
  bonusQtyInUnit: z.number().int().min(0).optional(),
});
const PoCreate = z.object({
  supplierId: z.string().uuid(), currency: z.enum(CURRENCY_CODES), expectedDate: isoDate.optional(), lines: z.array(PoLine).min(1).max(500),
  invoiceDiscount: Discount.optional(), notes: z.string().max(500).optional(),
});
const PoListQ = z.object({ supplierId: z.string().uuid().optional(), status: z.string().max(30).optional(), ...Paging });
const ReorderQ = z.object({ itemId: z.string().uuid() });

const GrnLine = z.object({
  poLineId: z.string().uuid().optional(), itemId: z.string().uuid(), unitId: z.string().uuid(), qtyInUnit: z.number().int().positive(), bonusQtyInUnit: z.number().int().min(0).optional(),
  unitCostMinor: intStr, discount: Discount.optional(), lotNumber: z.string().min(1).max(60), expiryDate: isoDate.optional(), printedPublicPriceMinor: intStr.optional(),
  sourceType: z.enum(["OFFICIAL", "PARALLEL"]).optional(),
});
const Grn = z.object({
  supplierId: z.string().uuid(), purchaseOrderId: z.string().uuid().optional(), locationId: z.string().uuid(), currency: z.enum(CURRENCY_CODES),
  invoiceRef: z.string().max(80).optional(), businessDate: isoDate.optional(), lines: z.array(GrnLine).min(1).max(500), invoiceDiscount: Discount.optional(),
  landedCosts: z.array(z.object({
    type: z.enum(["FREIGHT", "CUSTOMS", "CLEARANCE", "LOADING", "OTHER"]), amountMinor: intStr, currency: z.enum(CURRENCY_CODES), method: z.enum(["BY_VALUE", "BY_QTY"]).optional(),
  })).optional(),
  bonusCostPolicy: z.enum(["ZERO_COST", "SPREAD_COST_OVER_PAID_AND_BONUS"]).optional(), notes: z.string().max(500).optional(),
});
const GrnListQ = z.object({ supplierId: z.string().uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), ...Paging });

const actorOf = (me: Principal): Actor => ({ userId: me.userId, permissions: me.access.permissions });

@Controller()
export class PurchasingController {
  constructor(@Inject(SuppliersService) private readonly suppliers: SuppliersService, @Inject(PurchasingService) private readonly purchasing: PurchasingService) {}

  @Get("suppliers") @RequirePermissions("suppliers.read")
  listSuppliers(@CurrentUser() me: Principal, @Query() q: unknown) { return this.suppliers.list(me.tenantId, parse(SupplierListQ, q)); }

  @Get("suppliers/:id") @RequirePermissions("suppliers.read")
  getSupplier(@CurrentUser() me: Principal, @Param("id") id: string) { return this.suppliers.get(me.tenantId, id); }

  @Post("suppliers") @RequirePermissions("suppliers.manage")
  createSupplier(@CurrentUser() me: Principal, @Body() body: unknown) { return this.suppliers.create(me.tenantId, me.userId, parse(Supplier, body)); }

  @Patch("suppliers/:id") @RequirePermissions("suppliers.manage")
  patchSupplier(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) { return this.suppliers.patch(me.tenantId, me.userId, id, parse(SupplierPatch, body)); }

  @Get("purchase-orders/reorder-suggestions") @RequirePermissions("purchase_orders.read")
  reorder(@CurrentUser() me: Principal, @Query() q: unknown) { return this.purchasing.reorderSuggestion(me.tenantId, parse(ReorderQ, q).itemId); }

  @Post("purchase-orders") @RequirePermissions("purchase_orders.create")
  createPo(@CurrentUser() me: Principal, @Body() body: unknown) { return this.purchasing.createPo(me.tenantId, actorOf(me), parse(PoCreate, body)); }

  @Post("purchase-orders/:id/approve") @HttpCode(200) @RequirePermissions("purchase_orders.create")
  approvePo(@CurrentUser() me: Principal, @Param("id") id: string) { return this.purchasing.approvePo(me.tenantId, actorOf(me), id); }

  @Get("purchase-orders") @RequirePermissions("purchase_orders.read")
  listPos(@CurrentUser() me: Principal, @Query() q: unknown) { return this.purchasing.listPos(me.tenantId, parse(PoListQ, q)); }

  @Get("purchase-orders/:id") @RequirePermissions("purchase_orders.read")
  getPo(@CurrentUser() me: Principal, @Param("id") id: string) { return this.purchasing.getPo(me.tenantId, id); }

  @Post("goods-receipts") @RequirePermissions("goods_receipts.create", "goods_receipts.post")
  postGrn(@CurrentUser() me: Principal, @Body() body: unknown) { return this.purchasing.postGrn(me.tenantId, actorOf(me), parse(Grn, body)); }

  @Get("goods-receipts") @RequirePermissions("goods_receipts.read")
  listGrns(@CurrentUser() me: Principal, @Query() q: unknown) { return this.purchasing.listGrns(me.tenantId, parse(GrnListQ, q)); }

  @Get("goods-receipts/:id") @RequirePermissions("goods_receipts.read")
  getGrn(@CurrentUser() me: Principal, @Param("id") id: string) { return this.purchasing.getGrn(me.tenantId, id); }
}
