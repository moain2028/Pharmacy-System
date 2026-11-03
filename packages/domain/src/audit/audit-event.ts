/**
 * AuditEvent — FR-IAM-110/111/112. An immutable fact for the append-only `audit_log`.
 * `before`/`after` are JSON snapshots; `changes` is the computed `diff_json` (changed fields only,
 * computed when both snapshots are given). `redact` masks secrets (password/PIN/tokens) so that no
 * PIN or password ever reaches the log in clear text ("small things" #11).
 */
import { domainErr, ok, type Result } from "../shared/result.js";
import { diff, maskFields, normalizeFieldName, normalizeFieldNames, toJson, type FieldChange, type Json } from "./diff.js";

export const AUDIT_ACTIONS = [
  "create", "update", "delete", "post", "reverse", "print", "login", "export", "import",
  "settings_change", "permission_change", "backup", "restore", "price_change",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(x: unknown): x is AuditAction {
  return typeof x === "string" && (AUDIT_ACTIONS as readonly string[]).includes(x);
}

export interface AuditEventProps {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly onBehalfOf?: string;
  readonly approvedBy?: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
  readonly deviceId: string;
  readonly occurredAt: Date;
  readonly ip?: string;
}

export interface AuditEventFields {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly onBehalfOf: string | undefined;
  readonly approvedBy: string | undefined;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | undefined;
  readonly before: Json;
  readonly after: Json;
  readonly changes: readonly FieldChange[];
  readonly reason: string | undefined;
  readonly deviceId: string;
  readonly occurredAt: Date;
  readonly ip: string | undefined;
}

export interface AuditEventJSON {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly onBehalfOf: string | null;
  readonly approvedBy: string | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly before: Json;
  readonly after: Json;
  readonly changes: readonly FieldChange[];
  readonly reason: string | null;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly ip: string | null;
}

const MASK = "***";
const optional = (s: string | undefined): string | undefined => (s === undefined || s.trim().length === 0 ? undefined : s.trim());

function maskChange(change: FieldChange, fields: ReadonlySet<string>): FieldChange {
  const leaf = normalizeFieldName(change.path.slice(change.path.lastIndexOf(".") + 1).replace(/\[\d+\]$/, ""));
  if (fields.has(leaf)) {
    return Object.freeze({
      path: change.path,
      before: change.before === null ? null : MASK,
      after: change.after === null ? null : MASK,
    });
  }
  return Object.freeze({ path: change.path, before: maskFields(change.before, fields), after: maskFields(change.after, fields) });
}

export class AuditEvent implements AuditEventFields {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly onBehalfOf: string | undefined;
  readonly approvedBy: string | undefined;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | undefined;
  readonly before: Json;
  readonly after: Json;
  readonly changes: readonly FieldChange[];
  readonly reason: string | undefined;
  readonly deviceId: string;
  private readonly occurredAtMs: number;
  readonly ip: string | undefined;

  private constructor(f: AuditEventFields) {
    this.eventId = f.eventId;
    this.tenantId = f.tenantId;
    this.actorUserId = f.actorUserId;
    this.onBehalfOf = f.onBehalfOf;
    this.approvedBy = f.approvedBy;
    this.action = f.action;
    this.entityType = f.entityType;
    this.entityId = f.entityId;
    this.entityLabel = f.entityLabel;
    this.before = f.before;
    this.after = f.after;
    this.changes = f.changes;
    this.reason = f.reason;
    this.deviceId = f.deviceId;
    this.occurredAtMs = f.occurredAt.getTime();
    this.ip = f.ip;
    Object.freeze(this);
  }

  /** Defensive copy — Date is mutable and the event must stay an immutable fact. */
  get occurredAt(): Date {
    return new Date(this.occurredAtMs);
  }

  static create(props: AuditEventProps): Result<AuditEvent> {
    const required: readonly (readonly [string, string])[] = [
      ["eventId", props.eventId], ["tenantId", props.tenantId], ["actorUserId", props.actorUserId],
      ["entityType", props.entityType], ["entityId", props.entityId], ["deviceId", props.deviceId],
    ];
    for (const [field, value] of required) {
      if (typeof value !== "string" || value.trim().length === 0) {
        return domainErr("audit.invalid_field", `${field} must not be blank`, { field });
      }
    }
    if (!isAuditAction(props.action)) {
      return domainErr("audit.invalid_action", `Unknown audit action: ${props.action}`, { action: props.action });
    }
    if (!(props.occurredAt instanceof Date) || Number.isNaN(props.occurredAt.getTime())) {
      return domainErr("audit.invalid_time", "occurredAt must be a valid Date");
    }
    const actorUserId = props.actorUserId.trim();
    const approvedBy = optional(props.approvedBy);
    if (approvedBy !== undefined && approvedBy === actorUserId) {
      return domainErr("audit.self_approval", "approvedBy must be a different user than the actor", { actorUserId });
    }
    const before = toJson(props.before);
    const after = toJson(props.after);
    const changes = props.before !== undefined && props.after !== undefined ? diff(before, after) : Object.freeze([] as FieldChange[]);
    return ok(
      new AuditEvent({
        eventId: props.eventId.trim(),
        tenantId: props.tenantId.trim(),
        actorUserId,
        onBehalfOf: optional(props.onBehalfOf),
        approvedBy,
        action: props.action,
        entityType: props.entityType.trim(),
        entityId: props.entityId.trim(),
        entityLabel: optional(props.entityLabel),
        before,
        after,
        changes,
        reason: optional(props.reason),
        deviceId: props.deviceId.trim(),
        occurredAt: props.occurredAt,
        ip: optional(props.ip),
      }),
    );
  }

  hasChanges(): boolean {
    return this.changes.length > 0;
  }

  changedPaths(): readonly string[] {
    return Object.freeze(this.changes.map((c) => c.path));
  }

  /** New event with secrets masked in `before`, `after` and `changes`. `fields` must be normalised. */
  withMasked(fields: ReadonlySet<string>): AuditEvent {
    return new AuditEvent({
      ...this.snapshot(),
      before: maskFields(this.before, fields),
      after: maskFields(this.after, fields),
      changes: Object.freeze(this.changes.map((c) => maskChange(c, fields))),
    });
  }

  toJSON(): AuditEventJSON {
    return {
      eventId: this.eventId,
      tenantId: this.tenantId,
      actorUserId: this.actorUserId,
      onBehalfOf: this.onBehalfOf ?? null,
      approvedBy: this.approvedBy ?? null,
      action: this.action,
      entityType: this.entityType,
      entityId: this.entityId,
      entityLabel: this.entityLabel ?? null,
      before: this.before,
      after: this.after,
      changes: this.changes,
      reason: this.reason ?? null,
      deviceId: this.deviceId,
      occurredAt: this.occurredAt.toISOString(),
      ip: this.ip ?? null,
    };
  }

  private snapshot(): AuditEventFields {
    return {
      eventId: this.eventId,
      tenantId: this.tenantId,
      actorUserId: this.actorUserId,
      onBehalfOf: this.onBehalfOf,
      approvedBy: this.approvedBy,
      action: this.action,
      entityType: this.entityType,
      entityId: this.entityId,
      entityLabel: this.entityLabel,
      before: this.before,
      after: this.after,
      changes: this.changes,
      reason: this.reason,
      deviceId: this.deviceId,
      occurredAt: this.occurredAt,
      ip: this.ip,
    };
  }
}

/** Default secret field names (matched after normalisation: case/underscore/dash-insensitive). */
export const DEFAULT_REDACTED_FIELDS: readonly string[] = Object.freeze([
  "password", "password_hash", "pin", "manager_pin", "pin_hash", "token", "refresh_token", "access_token", "secret", "api_key",
]);

export function redact(event: AuditEvent, fieldsToMask: Iterable<string> = DEFAULT_REDACTED_FIELDS): AuditEvent {
  return event.withMasked(normalizeFieldNames(fieldsToMask));
}
