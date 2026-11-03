import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { PayablesService } from "./payables.service.js";

@Controller()
export class PayablesController {
  constructor(@Inject(PayablesService) private readonly payables: PayablesService) {}

  @Post("supplier-invoices")
  @RequirePermissions("supplier_invoices.create", "supplier_invoices.post")
  postInvoice(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.payables.postSupplierInvoice(me.tenantId, { userId: me.userId }, body);
  }

  @Get("supplier-invoices")
  @RequirePermissions("supplier_invoices.read")
  listInvoices(@CurrentUser() me: Principal, @Query() query: unknown) {
    return this.payables.listInvoices(me.tenantId, query);
  }

  @Get("supplier-invoices/:id")
  @RequirePermissions("supplier_invoices.read")
  getInvoice(@CurrentUser() me: Principal, @Param("id") id: string) {
    return this.payables.getInvoice(me.tenantId, id);
  }

  @Post("purchase-returns")
  @RequirePermissions("purchase_returns.create", "purchase_returns.post")
  postReturn(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.payables.postPurchaseReturn(me.tenantId, { userId: me.userId }, body);
  }

  @Post("supplier-payments")
  @RequirePermissions("payables.pay")
  paySupplier(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.payables.paySupplier(me.tenantId, { userId: me.userId }, body);
  }

  @Get("suppliers/:id/ledger")
  @RequirePermissions("suppliers.read")
  supplierLedger(@CurrentUser() me: Principal, @Param("id") id: string) {
    return this.payables.supplierLedger(me.tenantId, id);
  }
}
