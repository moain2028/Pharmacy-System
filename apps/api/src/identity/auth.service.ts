import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import { Db } from "../infra/db.js";
import { CONFIG, type AppConfig } from "../infra/config.js";
import { ApiError } from "../shared/errors.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { resolveAccess, type EffectiveAccess, type Override, type RoleGrant } from "./permissions.js";
import { TokenService } from "./tokens.js";

export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly username: string;
  readonly displayName: string;
  readonly locale: "ar" | "en";
  readonly access: EffectiveAccess;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSec: number;
  readonly user: { id: string; username: string; displayName: string; locale: string; permissions: string[]; limits: Record<string, number> };
  readonly tenant: { id: string; nameAr: string; nameEn: string; baseCurrency: string };
}

interface UserRow {
  id: string; tenant_id: string; username: string; display_name: string; password_hash: string; locale: "ar" | "en";
  is_active: boolean; failed_logins: number; locked_until: Date | null;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  readonly tokens: TokenService;
  constructor(@Inject(Db) private readonly db: Db, @Inject(CONFIG) private readonly cfg: AppConfig) {
    this.tokens = new TokenService(cfg.JWT_SECRET, cfg.ACCESS_TOKEN_TTL_SEC);
  }

  /** Username is unique per tenant; for a single-pharmacy install the tenant is resolved automatically. */
  async login(input: { username: string; password: string; tenantId?: string | undefined; deviceId?: string | undefined }): Promise<LoginResult> {
    const admin = this.db.admin();
    const rows = await admin<UserRow[]>`SELECT id, tenant_id, username, display_name, password_hash, locale, is_active, failed_logins, locked_until
      FROM users WHERE lower(username) = lower(${input.username}) ${input.tenantId ? admin`AND tenant_id = ${input.tenantId}` : admin``}`;
    if (rows.length !== 1) {
      // constant-time-ish: still hash to avoid user enumeration by timing
      await verifyPassword("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", input.password);
      throw ApiError.unauthorized("auth.invalid_credentials", "Invalid username or password");
    }
    const u = rows[0]!;
    if (!u.is_active) throw ApiError.forbidden("auth.user_inactive", "User is deactivated");
    if (u.locked_until && u.locked_until.getTime() > Date.now()) {
      throw ApiError.forbidden("auth.locked", `Account locked until ${u.locked_until.toISOString()}`, { lockedUntil: u.locked_until.toISOString() });
    }
    const okPw = await verifyPassword(u.password_hash, input.password);
    if (!okPw) {
      const failed = u.failed_logins + 1;
      await this.db.tx(u.tenant_id, (tx) => tx`UPDATE users SET failed_logins = ${failed},
        locked_until = ${failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null} WHERE id = ${u.id}`);
      throw ApiError.unauthorized("auth.invalid_credentials", "Invalid username or password");
    }
    return this.db.tx(u.tenant_id, async (tx) => {
      if (u.failed_logins > 0 || u.locked_until) await tx`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${u.id}`;
      if (needsRehash(u.password_hash)) await tx`UPDATE users SET password_hash = ${await hashPassword(input.password)} WHERE id = ${u.id}`;
      const access = await this.loadAccess(tx, u.id);
      const [t] = await tx<{ id: string; name_ar: string; name_en: string; base_currency: string }[]>`SELECT id, name_ar, name_en, base_currency FROM tenants WHERE id = ${u.tenant_id}`;
      const refresh = TokenService.newRefreshToken();
      await tx`INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, device_id, expires_at)
        VALUES (${u.tenant_id}, ${u.id}, ${refresh.hash}, ${input.deviceId ?? null}, ${new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_SEC * 1000)})`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, device_id) VALUES (${u.tenant_id}, ${u.id}, 'auth.login', 'user', ${u.id}, ${input.deviceId ?? null})`;
      const accessToken = await this.tokens.signAccess({ sub: u.id, tid: u.tenant_id, usr: u.username, perms: [...access.permissions], loc: u.locale, ...(input.deviceId ? { dev: input.deviceId } : {}) });
      return {
        accessToken,
        refreshToken: refresh.token,
        expiresInSec: this.cfg.ACCESS_TOKEN_TTL_SEC,
        user: { id: u.id, username: u.username, displayName: u.display_name, locale: u.locale, permissions: [...access.permissions].sort(), limits: { ...access.limits } },
        tenant: { id: t!.id, nameAr: t!.name_ar, nameEn: t!.name_en, baseCurrency: t!.base_currency },
      };
    });
  }

  /** Rotating refresh: old token is revoked, a new one issued; reuse of a revoked token revokes the whole family. */
  async refresh(refreshToken: string, deviceId?: string | undefined): Promise<LoginResult> {
    const hash = TokenService.hashRefresh(refreshToken);
    const admin = this.db.admin();
    const [row] = await admin<{ id: string; tenant_id: string; user_id: string; expires_at: Date; revoked_at: Date | null }[]>`
      SELECT id, tenant_id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ${hash}`;
    if (!row) throw ApiError.unauthorized("auth.refresh_invalid", "Refresh token invalid");
    if (row.revoked_at) {
      await this.db.tx(row.tenant_id, (tx) => tx`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${row.user_id} AND revoked_at IS NULL`);
      throw ApiError.unauthorized("auth.refresh_reused", "Refresh token reuse detected; all sessions revoked");
    }
    if (row.expires_at.getTime() < Date.now()) throw ApiError.unauthorized("auth.refresh_expired", "Refresh token expired");
    return this.db.tx(row.tenant_id, async (tx) => {
      const [u] = await tx<UserRow[]>`SELECT id, tenant_id, username, display_name, password_hash, locale, is_active, failed_logins, locked_until FROM users WHERE id = ${row.user_id}`;
      if (!u || !u.is_active) throw ApiError.forbidden("auth.user_inactive", "User is deactivated");
      await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE id = ${row.id}`;
      const next = TokenService.newRefreshToken();
      await tx`INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, device_id, expires_at)
        VALUES (${u.tenant_id}, ${u.id}, ${next.hash}, ${deviceId ?? null}, ${new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_SEC * 1000)})`;
      const access = await this.loadAccess(tx, u.id);
      const [t] = await tx<{ id: string; name_ar: string; name_en: string; base_currency: string }[]>`SELECT id, name_ar, name_en, base_currency FROM tenants WHERE id = ${u.tenant_id}`;
      const accessToken = await this.tokens.signAccess({ sub: u.id, tid: u.tenant_id, usr: u.username, perms: [...access.permissions], loc: u.locale, ...(deviceId ? { dev: deviceId } : {}) });
      return {
        accessToken, refreshToken: next.token, expiresInSec: this.cfg.ACCESS_TOKEN_TTL_SEC,
        user: { id: u.id, username: u.username, displayName: u.display_name, locale: u.locale, permissions: [...access.permissions].sort(), limits: { ...access.limits } },
        tenant: { id: t!.id, nameAr: t!.name_ar, nameEn: t!.name_en, baseCurrency: t!.base_currency },
      };
    });
  }

  async logout(tenantId: string, userId: string, refreshToken?: string | undefined): Promise<void> {
    await this.db.tx(tenantId, async (tx) => {
      if (refreshToken) await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = ${TokenService.hashRefresh(refreshToken)} AND revoked_at IS NULL`;
      else await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id) VALUES (${tenantId}, ${userId}, 'auth.logout', 'user', ${userId})`;
    });
  }

  async loadAccess(tx: Sql, userId: string): Promise<EffectiveAccess> {
    const roles = await tx<{ permissions: string[]; limits: Record<string, number> }[]>`
      SELECT r.permissions, r.limits FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${userId}`;
    const overrides = await tx<{ permission: string; effect: "ALLOW" | "DENY"; limit_value: string | null }[]>`
      SELECT permission, effect, limit_value FROM user_permission_overrides WHERE user_id = ${userId}`;
    const grants: RoleGrant[] = roles.map((r) => ({ permissions: r.permissions, limits: r.limits ?? {} }));
    const ov: Override[] = overrides.map((o) => ({ permission: o.permission, effect: o.effect, limitValue: o.limit_value === null ? null : Number(o.limit_value) }));
    return resolveAccess(grants, ov);
  }

  /** Verifies a manager PIN or password for elevation (e.g. approve discount above limit). */
  async elevate(tenantId: string, approver: { username: string; secret: string }, permission: string): Promise<{ approverId: string }> {
    return this.db.tx(tenantId, async (tx) => {
      const [u] = await tx<{ id: string; password_hash: string; pin_hash: string | null; is_active: boolean }[]>`SELECT id, password_hash, pin_hash, is_active FROM users WHERE lower(username) = lower(${approver.username})`;
      if (!u || !u.is_active) throw ApiError.forbidden("auth.elevation_denied", "Approver not found");
      const okPin = u.pin_hash ? await verifyPassword(u.pin_hash, approver.secret) : false;
      const okPw = okPin ? true : await verifyPassword(u.password_hash, approver.secret);
      if (!okPw) throw ApiError.forbidden("auth.elevation_denied", "Approver credentials invalid");
      const access = await this.loadAccess(tx, u.id);
      if (!access.permissions.has(permission)) throw ApiError.forbidden("auth.elevation_denied", `Approver lacks ${permission}`, { permission });
      return { approverId: u.id };
    });
  }
}
