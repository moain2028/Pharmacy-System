import { Body, Controller, Get, Inject, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { parse } from "../shared/validation.js";
import type { Principal } from "./auth.service.js";
import { CurrentUser, RequirePermissions } from "./auth.guard.js";
import { UsersService } from "./users.service.js";

const CreateUser = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), displayName: z.string().min(1).max(120), password: z.string().min(8).max(256),
  locale: z.enum(["ar", "en"]).optional(), pin: z.string().min(4).max(12).regex(/^\d+$/).optional(), roleIds: z.array(z.string().uuid()).min(1),
});
const UpdateUser = z.object({
  displayName: z.string().min(1).max(120).optional(), locale: z.enum(["ar", "en"]).optional(), isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(), password: z.string().min(8).max(256).optional(), pin: z.string().min(4).max(12).regex(/^\d+$/).nullable().optional(),
});
const Overrides = z.object({ overrides: z.array(z.object({ permission: z.string(), effect: z.enum(["ALLOW", "DENY"]), limitValue: z.number().int().nullable().optional() })) });
const RoleDto = z.object({ id: z.string().uuid().optional(), code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/), nameAr: z.string().min(1), nameEn: z.string().min(1), permissions: z.array(z.string()), limits: z.record(z.number()).default({}) });

@Controller()
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get("users") @RequirePermissions("users.read")
  list(@CurrentUser() me: Principal) { return this.users.list(me.tenantId); }

  @Post("users") @RequirePermissions("users.create")
  create(@CurrentUser() me: Principal, @Body() body: unknown) {
    const dto = parse(CreateUser, body);
    return this.users.create(me.tenantId, me.userId, dto);
  }

  @Patch("users/:id") @RequirePermissions("users.update")
  async update(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) {
    const dto = parse(UpdateUser, body);
    await this.users.update(me.tenantId, me.userId, id, dto);
    return { ok: true };
  }

  @Put("users/:id/overrides") @RequirePermissions("roles.manage")
  async overrides(@CurrentUser() me: Principal, @Param("id") id: string, @Body() body: unknown) {
    const dto = parse(Overrides, body);
    await this.users.setOverrides(me.tenantId, me.userId, id, dto.overrides);
    return { ok: true };
  }

  @Get("roles") @RequirePermissions("roles.read")
  roles(@CurrentUser() me: Principal) { return this.users.listRoles(me.tenantId); }

  @Post("roles") @RequirePermissions("roles.manage")
  upsertRole(@CurrentUser() me: Principal, @Body() body: unknown) {
    const dto = parse(RoleDto, body);
    return this.users.upsertRole(me.tenantId, me.userId, dto);
  }
}
