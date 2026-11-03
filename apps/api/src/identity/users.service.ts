import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { hashPassword } from "./password.js";
import { isPermission } from "./permissions.js";

export interface UserView {
  id: string; username: string; displayName: string; locale: string; isActive: boolean;
  roles: Array<{ id: string; code: string; nameAr: string; nameEn: string }>;
  overrides: Array<{ permission: string; effect: "ALLOW" | "DENY"; limitValue: number | null }>;
  lockedUntil: Date | null; createdAt: Date; version: number;
}

@Injectable()
export class UsersService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(tenantId: string): Promise<UserView[]> {
    return this.db.tx(tenantId, async (tx) => {
      const users = await tx<Array<{ id: string; username: string; display_name: string; locale: string; is_active: boolean; locked_until: Date | null; created_at: Date; version: number }>>`
        SELECT id, username, display_name, locale, is_active, locked_until, created_at, version FROM users ORDER BY created_at`;
      const roles = await tx<Array<{ user_id: string; id: string; code: string; name_ar: string; name_en: string }>>`
        SELECT ur.user_id, r.id, r.code, r.name_ar, r.name_en FROM user_roles ur JOIN roles r ON r.id = ur.role_id`;
      const ov = await tx<Array<{ user_id: string; permission: string; effect: "ALLOW" | "DENY"; limit_value: string | null }>>`SELECT user_id, permission, effect, limit_value FROM user_permission_overrides`;
      return users.map((u) => ({
        id: u.id, username: u.username, displayName: u.display_name, locale: u.locale, isActive: u.is_active, lockedUntil: u.locked_until, createdAt: u.created_at, version: u.version,
        roles: roles.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en })),
        overrides: ov.filter((o) => o.user_id === u.id).map((o) => ({ permission: o.permission, effect: o.effect, limitValue: o.limit_value === null ? null : Number(o.limit_value) })),
      }));
    });
  }

  async create(tenantId: string, actorId: string, input: { username: string; displayName: string; password: string; locale?: "ar" | "en" | undefined; pin?: string | undefined; roleIds: string[] }): Promise<{ id: string }> {
    const hash = await hashPassword(input.password);
    const pin = input.pin ? await hashPassword(input.pin) : null;
    return this.db.tx(tenantId, async (tx) => {
      const [u] = await tx<{ id: string }[]>`INSERT INTO users (tenant_id, username, display_name, password_hash, pin_hash, locale)
        VALUES (${tenantId}, ${input.username}, ${input.displayName}, ${hash}, ${pin}, ${input.locale ?? "ar"}) RETURNING id`;
      for (const rid of input.roleIds) await tx`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES (${tenantId}, ${u!.id}, ${rid})`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'users.create', 'user', ${u!.id}, ${tx.json({ username: input.username, roleIds: input.roleIds })})`;
      return { id: u!.id };
    });
  }

  async update(tenantId: string, actorId: string, userId: string, patch: { displayName?: string | undefined; locale?: "ar" | "en" | undefined; isActive?: boolean | undefined; roleIds?: string[] | undefined; password?: string | undefined; pin?: string | null | undefined }): Promise<void> {
    const pwHash = patch.password ? await hashPassword(patch.password) : undefined;
    const pinHash = patch.pin ? await hashPassword(patch.pin) : patch.pin === null ? null : undefined;
    await this.db.tx(tenantId, async (tx) => {
      const [exists] = await tx<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}`;
      if (!exists) throw ApiError.notFound("users.not_found", "User not found");
      if (patch.isActive === false && userId === actorId) throw ApiError.conflict("users.cannot_deactivate_self", "You cannot deactivate yourself");
      if (patch.displayName !== undefined) await tx`UPDATE users SET display_name = ${patch.displayName} WHERE id = ${userId}`;
      if (patch.locale !== undefined) await tx`UPDATE users SET locale = ${patch.locale} WHERE id = ${userId}`;
      if (patch.isActive !== undefined) {
        await tx`UPDATE users SET is_active = ${patch.isActive} WHERE id = ${userId}`;
        if (!patch.isActive) await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
      }
      if (pwHash) {
        await tx`UPDATE users SET password_hash = ${pwHash}, password_changed_at = now(), failed_logins = 0, locked_until = NULL WHERE id = ${userId}`;
        await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
      }
      if (pinHash !== undefined) await tx`UPDATE users SET pin_hash = ${pinHash} WHERE id = ${userId}`;
      if (patch.roleIds) {
        await tx`DELETE FROM user_roles WHERE user_id = ${userId}`;
        for (const rid of patch.roleIds) await tx`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES (${tenantId}, ${userId}, ${rid})`;
      }
      const { password: _p, pin: _q, ...safe } = patch;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'users.update', 'user', ${userId}, ${tx.json({ ...safe, passwordChanged: !!pwHash, pinChanged: pinHash !== undefined })})`;
    });
  }

  async setOverrides(tenantId: string, actorId: string, userId: string, overrides: Array<{ permission: string; effect: "ALLOW" | "DENY"; limitValue?: number | null | undefined }>): Promise<void> {
    const bad = overrides.filter((o) => !isPermission(o.permission)).map((o) => o.permission);
    if (bad.length) throw ApiError.badRequest("permissions.unknown", "Unknown permission(s)", { unknown: bad });
    await this.db.tx(tenantId, async (tx) => {
      await tx`DELETE FROM user_permission_overrides WHERE user_id = ${userId}`;
      for (const o of overrides) {
        await tx`INSERT INTO user_permission_overrides (tenant_id, user_id, permission, effect, limit_value) VALUES (${tenantId}, ${userId}, ${o.permission}, ${o.effect}, ${o.limitValue ?? null})`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'users.set_overrides', 'user', ${userId}, ${tx.json({ overrides })})`;
    });
  }

  async listRoles(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx<Array<{ id: string; code: string; name_ar: string; name_en: string; is_system: boolean; permissions: string[]; limits: Record<string, number> }>>`
      SELECT id, code, name_ar, name_en, is_system, permissions, limits FROM roles ORDER BY is_system DESC, code`);
  }

  async upsertRole(tenantId: string, actorId: string, input: { id?: string | undefined; code: string; nameAr: string; nameEn: string; permissions: string[]; limits: Record<string, number> }): Promise<{ id: string }> {
    const bad = input.permissions.filter((p) => p !== "*" && !p.endsWith(".*") && !isPermission(p));
    if (bad.length) throw ApiError.badRequest("permissions.unknown", "Unknown permission(s)", { unknown: bad });
    return this.db.tx(tenantId, async (tx) => {
      let id = input.id;
      if (id) {
        const [r] = await tx<{ is_system: boolean; code: string }[]>`SELECT is_system, code FROM roles WHERE id = ${id}`;
        if (!r) throw ApiError.notFound("roles.not_found", "Role not found");
        if (r.is_system && r.code === "OWNER") throw ApiError.conflict("roles.owner_locked", "OWNER role cannot be modified");
        await tx`UPDATE roles SET name_ar = ${input.nameAr}, name_en = ${input.nameEn}, permissions = ${tx.array(input.permissions)}, limits = ${tx.json(input.limits)} WHERE id = ${id}`;
      } else {
        const [r] = await tx<{ id: string }[]>`INSERT INTO roles (tenant_id, code, name_ar, name_en, permissions, limits) VALUES (${tenantId}, ${input.code}, ${input.nameAr}, ${input.nameEn}, ${tx.array(input.permissions)}, ${tx.json(input.limits)}) RETURNING id`;
        id = r!.id;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'roles.upsert', 'role', ${id}, ${tx.json(input)})`;
      return { id };
    });
  }
}
