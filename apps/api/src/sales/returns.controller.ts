import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../identity/auth.service.js";
import { CurrentUser, RequirePermissions } from "../identity/auth.guard.js";
import { parse } from "../shared/validation.js";
import { ReturnListSchema, ReturnRequestSchema, ReturnsService } from "./returns.service.js";

const Id = z.string().uuid();

@Controller()
export class ReturnsController {
  constructor(@Inject(ReturnsService) private readonly returns: ReturnsService) {}

  @Post("returns/quote") @HttpCode(200) @RequirePermissions("returns.create")
  quote(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.returns.quote(me.tenantId, { userId: me.userId, permissions: me.access.permissions }, parse(ReturnRequestSchema, body));
  }

  @Post("returns") @RequirePermissions("returns.create", "returns.post")
  post(@CurrentUser() me: Principal, @Body() body: unknown) {
    return this.returns.post(me.tenantId, { userId: me.userId, permissions: me.access.permissions }, parse(ReturnRequestSchema, body));
  }

  @Get("returns") @RequirePermissions("sales.read")
  list(@CurrentUser() me: Principal, @Query() q: unknown) { return this.returns.list(me.tenantId, parse(ReturnListSchema, q)); }

  @Get("returns/:id") @RequirePermissions("sales.read")
  get(@CurrentUser() me: Principal, @Param("id") id: string) { return this.returns.get(me.tenantId, parse(Id, id)); }
}
