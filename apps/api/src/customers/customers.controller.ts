import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { CustomerCreateSchema, CustomerListSchema, CustomerPatchSchema, CustomersService, StatementQuerySchema } from "./customers.service.js";

const Id = z.string().uuid();

@Controller()
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get("customers") @RequirePermissions("customers.read")
  list(@CurrentUser() me: Principal, @Query() q: unknown) { return this.customers.list(me.tenantId, parse(CustomerListSchema, q)); }

  @Get("customers/:id/statement") @RequirePermissions("customers.read")
  statement(@CurrentUser() me: Principal, @Param("id") id: string, @Query() q: unknown) {
    return this.customers.statement(me.tenantId, parse(Id, id), parse(StatementQuerySchema, q));
  }

  @Get("customers/:id") @RequirePermissions("customers.read")
  get(@CurrentUser() me: Principal, @Param("id") id: string) { return this.customers.get(me.tenantId, parse(Id, id)); }

  @Post("customers") @RequirePermissions("customers.manage")
  create(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.customers.create(me.tenantId, { userId: me.userId, permissions: me.access.permissions }, parse(CustomerCreateSchema, body));
  }

  @Patch("customers/:id") @RequirePermissions("customers.manage")
  update(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) {
    return this.customers.update(me.tenantId, { userId: me.userId, permissions: me.access.permissions }, parse(Id, id), parse(CustomerPatchSchema, body));
  }
}
