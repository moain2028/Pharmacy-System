import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES } from "@pharmacore/domain";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { CatalogService } from "./catalog.service.js";
import { parseBarcode } from "./barcode.js";

const Unit = z.object({
  id: z.string().uuid().optional(), nameAr: z.string().min(1), nameEn: z.string().min(1), factorToSsu: z.number().int().min(1), level: z.number().int().min(1),
  isSsu: z.boolean().default(false), canSell: z.boolean().default(true), canPurchase: z.boolean().default(true),
  isDefaultSale: z.boolean().default(false), isDefaultPurchase: z.boolean().default(false), isStockDisplay: z.boolean().default(false),
});
const Item = z.object({
  itemCode: z.string().max(40).optional(), tradeNameAr: z.string().min(1).max(200), tradeNameEn: z.string().min(1).max(200), genericName: z.string().max(200).optional(),
  strength: z.string().max(60).optional(), dosageForm: z.string().max(60).optional(), manufacturer: z.string().max(120).optional(), agentName: z.string().max(120).optional(),
  countryOfOrigin: z.string().max(60).optional(), categoryId: z.string().uuid().optional(),
  rxRequired: z.enum(["NONE", "RX", "RX_RETAIN"]).default("NONE"), controlledClass: z.enum(["NONE", "PSYCHOTROPIC", "NARCOTIC", "PRECURSOR"]).default("NONE"),
  trackExpiry: z.boolean().default(true), requiresColdChain: z.boolean().default(false), isReturnable: z.boolean().default(true), taxBp: z.number().int().min(0).max(10000).default(0),
  minStockSsu: z.number().int().min(0).default(0), maxStockSsu: z.number().int().min(0).nullable().optional(), reorderPointSsu: z.number().int().min(0).nullable().optional(), notes: z.string().max(2000).optional(),
  units: z.array(Unit).min(1),
});
const ItemUpdate = Item.extend({ isActive: z.boolean().optional(), version: z.number().int() });
const Search = z.object({ q: z.string().optional(), barcode: z.string().optional(), categoryId: z.string().uuid().optional(), includeInactive: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const Barcode = z.object({ barcode: z.string().max(120).optional(), unitId: z.string().uuid(), isPrimary: z.boolean().default(false), generateInternal: z.boolean().default(false) });
const Price = z.object({ priceListId: z.string().uuid(), itemId: z.string().uuid(), unitId: z.string().uuid(), unitPriceMinor: z.string().regex(/^\d+$/), minPriceMinor: z.string().regex(/^\d+$/).nullable().optional(), reason: z.string().max(200).optional() });
const Official = z.object({ itemId: z.string().uuid(), unitId: z.string().uuid(), currency: z.enum(CURRENCY_CODES), publicPriceMinor: z.string().regex(/^\d+$/), sourceListRef: z.string().max(120).optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const Rate = z.object({ from: z.enum(CURRENCY_CODES), to: z.enum(CURRENCY_CODES), buyRateScaled: z.string().regex(/^\d+$/), sellRateScaled: z.string().regex(/^\d+$/), effectiveFrom: z.string().datetime().optional() });
const Category = z.object({ nameAr: z.string().min(1), nameEn: z.string().min(1), parentId: z.string().uuid().optional() });

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly svc: CatalogService) {}

  @Get("items") @RequirePermissions("items.read")
  search(@CurrentUser() me: Principal, @Query() query: unknown) {
    const q = parse(Search, query);
    return this.svc.search(me.tenantId, { text: q.q, barcode: q.barcode, categoryId: q.categoryId, activeOnly: !q.includeInactive, limit: q.limit, offset: q.offset });
  }
  @Get("items/:id") @RequirePermissions("items.read")
  get(@CurrentUser() me: Principal, @Param("id") id: string) { return this.svc.get(me.tenantId, id); }
  @Post("items") @RequirePermissions("items.create")
  create(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.create(me.tenantId, me.userId, parse(Item, body)); }
  @Put("items/:id") @RequirePermissions("items.update")
  update(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) { return this.svc.update(me.tenantId, me.userId, id, parse(ItemUpdate, body)); }
  @Post("items/:id/barcodes") @RequirePermissions("barcodes.manage")
  addBarcode(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) { return this.svc.addBarcode(me.tenantId, me.userId, id, parse(Barcode, body)); }
  @Get("barcodes/parse") @RequirePermissions("items.read")
  parseCode(@Query("code") code: string) { return parseBarcode(code ?? ""); }

  @Get("price-lists") @RequirePermissions("prices.read")
  priceLists(@CurrentUser() me: Principal) { return this.svc.priceLists(me.tenantId); }
  @Post("prices") @RequirePermissions("prices.update")
  setPrice(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.setPrice(me.tenantId, me.userId, parse(Price, body)); }
  @Post("official-prices") @RequirePermissions("prices.official_manage")
  setOfficial(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.setOfficialPrice(me.tenantId, me.userId, parse(Official, body)); }

  @Get("categories") @RequirePermissions("items.read")
  categories(@CurrentUser() me: Principal) { return this.svc.categories(me.tenantId); }
  @Post("categories") @RequirePermissions("categories.manage")
  createCategory(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.createCategory(me.tenantId, parse(Category, body)); }

  @Get("exchange-rates") @RequirePermissions("prices.read")
  rates(@CurrentUser() me: Principal) { return this.svc.currentRates(me.tenantId); }
  @Post("exchange-rates") @RequirePermissions("settings.currency")
  setRate(@CurrentUser() me: Principal, @Body() body: unknown) { return this.svc.setRate(me.tenantId, me.userId, parse(Rate, body)); }
}
