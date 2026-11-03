/**
 * Authorization — FR-IAM-104 (numeric limits) and FR-IAM-105 (manager PIN approval).
 *
 * `authorize` answers: may `ctx.actor` perform `permission` with the given magnitude?
 *   auth.forbidden       neither the actor nor the attached approver holds the permission
 *   auth.pin_required    the action is in the manager-PIN policy table and no valid approver is attached
 *   auth.limit_exceeded  |requested| exceeds the effective numeric limit (details: limit, requested)
 * With an approver attached via `elevate`, the approver's permissions cover what the actor lacks and
 * the most permissive of actor/approver limits applies. Limits are compared as integers
 * (bp = 0.01 %), so "5.01 % vs 5 %" is 501 > 500 with no float rounding.
 * Missing magnitudes for limited permissions are programmer errors (thrown), never silent passes.
 */
import { DomainError, domainErr, ok, type Result } from "../shared/result.js";
import { isBpLimit, PERMISSIONS, type LimitName, type PermissionKey } from "./permissions.js";
import { can, limitFor, requireManagerPin, type UserAccess } from "./user-access.js";

export interface AuthContext {
  readonly actor: UserAccess;
  readonly deviceId: string;
  readonly approvedBy?: UserAccess;
}

export interface AuthorizeOptions {
  /** Amount in base-currency minor units for *_minor limits (sign ignored). */
  readonly amountMinor?: bigint;
  /** Basis points for *_bp limits (sign ignored: price deviation may be up or down). */
  readonly bp?: number;
}

export function createContext(actor: UserAccess, deviceId: string): AuthContext {
  return Object.freeze({ actor, deviceId });
}

const absBig = (v: bigint): bigint => (v < 0n ? -v : v);

function requestedValue(permission: PermissionKey, limitName: LimitName, opts: AuthorizeOptions): bigint {
  if (isBpLimit(limitName)) {
    const bp = opts.bp;
    if (bp === undefined) {
      throw new DomainError("auth.missing_value", `authorize(${permission}) requires opts.bp`, { permission, limitName });
    }
    if (!Number.isSafeInteger(bp)) {
      throw new DomainError("auth.non_integer_bp", "Basis points must be an integer", { permission, bp });
    }
    return absBig(BigInt(bp));
  }
  const amount = opts.amountMinor;
  if (amount === undefined) {
    throw new DomainError("auth.missing_value", `authorize(${permission}) requires opts.amountMinor`, { permission, limitName });
  }
  return absBig(amount);
}

/** Most permissive limit across holders; any unbounded holder makes the whole thing unbounded. */
function effectiveLimit(holders: readonly UserAccess[], limitName: LimitName): bigint | undefined {
  let best: bigint | undefined;
  for (const holder of holders) {
    const limit = limitFor(holder, limitName);
    if (limit === undefined) return undefined;
    if (best === undefined || limit > best) best = limit;
  }
  return best;
}

export function authorize(ctx: AuthContext, permission: PermissionKey, opts: AuthorizeOptions = {}): Result<void> {
  const actorCan = can(ctx.actor, permission);
  const approver = ctx.approvedBy;
  const approverCan = approver !== undefined && approver.userId !== ctx.actor.userId && can(approver, permission);
  const base = { permission, userId: ctx.actor.userId, deviceId: ctx.deviceId };

  if (!actorCan && !approverCan) {
    return domainErr("auth.forbidden", `Permission denied: ${permission}`, base);
  }
  if (requireManagerPin(permission) && !approverCan) {
    return domainErr("auth.pin_required", `Manager PIN approval required for ${permission}`, base);
  }
  const limitName = PERMISSIONS[permission].numericLimit;
  if (limitName === undefined) return ok(undefined);

  const requested = requestedValue(permission, limitName, opts);
  const holders: UserAccess[] = [];
  if (actorCan) holders.push(ctx.actor);
  if (approver !== undefined && approverCan) holders.push(approver);
  const limit = effectiveLimit(holders, limitName);
  if (limit === undefined || requested <= limit) return ok(undefined);
  return domainErr("auth.limit_exceeded", `${permission}: requested ${requested} exceeds limit ${limit}`, {
    ...base,
    limitName,
    limit: limit.toString(),
    requested: requested.toString(),
  });
}

/**
 * FR-IAM-105: attach a PIN approver (already PIN-verified by the application layer) to the context.
 * The approver must be active, a different user, and hold the permission being approved.
 */
export function elevate(ctx: AuthContext, pinApprover: UserAccess, permission: PermissionKey): Result<AuthContext> {
  const details = { permission, userId: ctx.actor.userId, approverId: pinApprover.userId };
  if (!pinApprover.active) return domainErr("auth.approver_inactive", "Approver account is disabled", details);
  if (pinApprover.userId === ctx.actor.userId) {
    return domainErr("auth.self_approval", "A user cannot approve their own action", details);
  }
  if (!can(pinApprover, permission)) {
    return domainErr("auth.approver_forbidden", `Approver lacks ${permission}`, details);
  }
  return ok(Object.freeze({ actor: ctx.actor, deviceId: ctx.deviceId, approvedBy: pinApprover }));
}
