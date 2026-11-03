import { type CanActivate, createParamDecorator, type ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../shared/errors.js";
import { AuthService, type Principal } from "./auth.service.js";
import type { Permission } from "./permissions.js";

export const PUBLIC_KEY = "pc:public";
export const PERMS_KEY = "pc:perms";
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** All listed permissions are required (AND). */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);

export type AuthedRequest = FastifyRequest & { principal?: Principal };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.principal) throw ApiError.unauthorized();
  return req.principal;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw ApiError.unauthorized();
    const claims = await this.auth.tokens.verifyAccess(header.slice(7));
    if (!claims) throw ApiError.unauthorized("auth.token_invalid", "Access token invalid or expired");
    const perms = new Set(claims.perms);
    req.principal = {
      userId: claims.sub, tenantId: claims.tid, username: claims.usr, displayName: claims.usr, locale: claims.loc,
      access: { permissions: perms, limits: {} },
    };
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const missing = required.filter((p) => !perms.has(p));
    if (missing.length > 0) throw ApiError.forbidden("auth.permission_denied", "Missing permission", { missing });
    return true;
  }
}
