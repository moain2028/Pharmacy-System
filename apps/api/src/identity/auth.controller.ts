import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { parse } from "../shared/validation.js";
import { AuthService, type Principal } from "./auth.service.js";
import { CurrentUser, Public } from "./auth.guard.js";
import { PERMISSIONS } from "./permissions.js";

const LoginDto = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256), tenantId: z.string().uuid().optional(), deviceId: z.string().max(128).optional() });
const RefreshDto = z.object({ refreshToken: z.string().min(16), deviceId: z.string().max(128).optional() });
const LogoutDto = z.object({ refreshToken: z.string().optional() });

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public() @Post("login") @HttpCode(200)
  login(@Body() body: unknown) {
    const dto = parse(LoginDto, body);
    return this.auth.login(dto);
  }

  @Public() @Post("refresh") @HttpCode(200)
  refresh(@Body() body: unknown) {
    const dto = parse(RefreshDto, body);
    return this.auth.refresh(dto.refreshToken, dto.deviceId);
  }

  @Post("logout") @HttpCode(204)
  async logout(@CurrentUser() me: Principal, @Body() body: unknown): Promise<void> {
    const dto = parse(LogoutDto, body ?? {});
    await this.auth.logout(me.tenantId, me.userId, dto.refreshToken);
  }

  @Get("me")
  me(@CurrentUser() me: Principal) {
    // `id` kept for backward compatibility; the web client reads `userId`/`displayName`.
    return { id: me.userId, userId: me.userId, tenantId: me.tenantId, username: me.username, displayName: me.displayName, locale: me.locale, permissions: [...me.access.permissions].sort() };
  }

  @Public() @Get("permissions")
  permissions() {
    return { permissions: PERMISSIONS };
  }
}
