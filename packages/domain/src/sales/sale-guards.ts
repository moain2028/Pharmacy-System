/**
 * Sales guards (FR-SAL-111/116/117/121/128/129/130, rule C3). Pure checks returning Result.
 * Overridable guards follow a policy: BLOCK | BLOCK_WITH_OVERRIDE | WARN. An override needs a
 * non-blank approverId + reason and the approver must hold the named resource.action permission.
 */
import { compareIsoDate, type IsoDate } from "../inventory/iso-date.js";
import { isSellableStatus, type LotEffectiveStatus } from "../inventory/lot.js";
import type { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";

export const PRICE_GUARD_POLICIES = ["BLOCK", "BLOCK_WITH_OVERRIDE", "WARN"] as const;
export type PriceGuardPolicy = (typeof PRICE_GUARD_POLICIES)[number];

export const SALES_PERMISSIONS = Object.freeze({
  sellBelowMin: "sales.sell_below_min",
  sellBelowCost: "sales.sell_below_cost",
  sellAboveOfficial: "sales.sell_above_official",
  zeroInvoice: "sales.zero_invoice",
  reverse: "sales.reverse",
  creditOverride: "sales.credit",
} as const);

export interface GuardOverride {
  readonly approverId: string;
  readonly permissions: readonly string[];
  readonly reason: string;
}

export interface GuardWarning {
  readonly code: string;
  readonly approvedBy: string | null;
  readonly reason: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface GuardSpec {
  readonly code: string;
  readonly message: string;
  readonly policy: PriceGuardPolicy;
  readonly permission: string;
  readonly details?: Record<string, unknown> | undefined;
}

const blank = (s: string | undefined): boolean => (s ?? "").trim() === "";

const warning = (code: string, approvedBy: string | null, reason: string | null, details: Record<string, unknown>): GuardWarning =>
  Object.freeze({ code, approvedBy, reason, details: Object.freeze({ ...details }) });

/** Evaluate a VIOLATED guard: returns the warning to record, or the blocking error. */
export function evaluateGuard(spec: GuardSpec, override?: GuardOverride): Result<GuardWarning> {
  const details = spec.details ?? {};
  if (spec.policy === "WARN") return ok(warning(spec.code, null, null, details));
  if (
    spec.policy === "BLOCK_WITH_OVERRIDE" && override !== undefined && !blank(override.approverId) &&
    !blank(override.reason) && override.permissions.includes(spec.permission)
  ) {
    return ok(warning(spec.code, override.approverId, override.reason, details));
  }
  const extra = spec.policy === "BLOCK" ? {} : { requiredPermission: spec.permission };
  return domainErr(spec.code, spec.message, { ...details, policy: spec.policy, ...extra });
}

// ------------------------------------------------------------------ price guards

export interface PriceGuardPolicies {
  readonly belowMin: PriceGuardPolicy;
  readonly belowCost: PriceGuardPolicy;
  readonly aboveOfficial: PriceGuardPolicy;
}

/** Official price is a hard ceiling by default (FR-SAL-116c). */
export const DEFAULT_PRICE_GUARD_POLICIES: PriceGuardPolicies = Object.freeze({
  belowMin: "BLOCK_WITH_OVERRIDE", belowCost: "BLOCK_WITH_OVERRIDE", aboveOfficial: "BLOCK",
});

export interface PriceGuardOverrides {
  readonly belowMin?: GuardOverride | undefined;
  readonly belowCost?: GuardOverride | undefined;
  readonly aboveOfficial?: GuardOverride | undefined;
}

export interface LinePriceCheck {
  readonly lineId: string;
  readonly qtyInUnit: bigint;
  readonly unitPrice: Money;
  /** Line net after line discounts AND the invoice-discount allocation (FR-SAL-121). */
  readonly lineNet: Money;
  readonly minUnitPrice: Money | null;
  readonly regulatedUnitPrice: Money | null;
  /** Sum of lot costs, in the invoice currency. */
  readonly lineCost: Money | null;
}

export function checkLinePrice(
  c: LinePriceCheck,
  policies: PriceGuardPolicies = DEFAULT_PRICE_GUARD_POLICIES,
  overrides: PriceGuardOverrides = {},
): Result<readonly GuardWarning[]> {
  const base = { lineId: c.lineId, net: c.lineNet.toDecimalString() };
  const checks: { violated: boolean; spec: GuardSpec; override: GuardOverride | undefined }[] = [
    {
      violated: c.regulatedUnitPrice !== null && c.unitPrice.gt(c.regulatedUnitPrice),
      override: overrides.aboveOfficial,
      spec: { code: "sales.above_official_price", message: "Price exceeds the official public price", policy: policies.aboveOfficial,
        permission: SALES_PERMISSIONS.sellAboveOfficial, details: { ...base, unitPrice: c.unitPrice.toDecimalString() } },
    },
    {
      violated: c.minUnitPrice !== null && c.lineNet.lt(c.minUnitPrice.multiply(c.qtyInUnit)),
      override: overrides.belowMin,
      spec: { code: "sales.below_min_price", message: "Net price is below the minimum selling price", policy: policies.belowMin,
        permission: SALES_PERMISSIONS.sellBelowMin, details: base },
    },
    {
      violated: c.lineCost !== null && c.lineNet.lt(c.lineCost),
      override: overrides.belowCost,
      spec: { code: "sales.below_cost", message: "Net price is below cost", policy: policies.belowCost,
        permission: SALES_PERMISSIONS.sellBelowCost, details: base },
    },
  ];
  const out: GuardWarning[] = [];
  for (const k of checks) {
    if (!k.violated) continue;
    const r = evaluateGuard(k.spec, k.override);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(Object.freeze(out));
}

// ------------------------------------------------------------------ lots, items, rx

export interface SellableLotRef {
  readonly lotId: string;
  readonly expiryDate: IsoDate;
  readonly status: LotEffectiveStatus;
}

/** C3 / FR-SAL-111: expiry_date <= business date or a non-sellable status blocks; no override. */
export function checkLotsSellable(lots: readonly SellableLotRef[], businessDate: IsoDate): Result<null> {
  for (const l of lots) {
    if (compareIsoDate(l.expiryDate, businessDate) <= 0) {
      return domainErr("sales.lot_expired", "Expired lots cannot be sold", { lotId: l.lotId, expiryDate: l.expiryDate, businessDate });
    }
    if (!isSellableStatus(l.status)) {
      return domainErr("sales.lot_not_sellable", "Lot status does not allow sale", { lotId: l.lotId, status: l.status });
    }
  }
  return ok(null);
}

export function checkItemActive(itemId: string, active: boolean): Result<null> {
  return active ? ok(null) : domainErr("sales.item_inactive", "Inactive items cannot be sold", { itemId });
}

export const RX_REQUIRED_VALUES = ["NONE", "RX", "RX_RETAIN"] as const;
export type RxRequired = (typeof RX_REQUIRED_VALUES)[number];
export const CONTROLLED_CLASSES = ["NONE", "PSYCHOTROPIC", "NARCOTIC", "PRECURSOR"] as const;
export type ControlledClass = (typeof CONTROLLED_CLASSES)[number];

export interface LineRxInfo {
  readonly rxRequired: RxRequired;
  readonly controlledClass: ControlledClass;
  readonly maxQtyPerRxSsu?: bigint | undefined;
}

export interface Prescription {
  readonly patientName: string;
  readonly doctorName: string;
  readonly rxNumber: string;
  readonly rxDate: IsoDate;
  readonly patientIdNo?: string | undefined;
}

export interface RxLineRef {
  readonly lineId: string;
  readonly rx: LineRxInfo;
  readonly ssuQty: bigint;
}

const prescriptionComplete = (p: Prescription | null): boolean =>
  p !== null && [p.patientName, p.doctorName, p.rxNumber, p.rxDate].every((s) => !blank(s));

/**
 * FR-SAL-129/130: controlled items or RX_RETAIN need a complete prescription (blocking);
 * plain RX without prescription yields a non-blocking advisory warning.
 */
export function checkPrescription(lines: readonly RxLineRef[], prescription: Prescription | null): Result<readonly GuardWarning[]> {
  const complete = prescriptionComplete(prescription);
  const out: GuardWarning[] = [];
  for (const l of lines) {
    const controlled = l.rx.controlledClass !== "NONE";
    if ((controlled || l.rx.rxRequired === "RX_RETAIN") && !complete) {
      return domainErr("sales.prescription_required", "A complete prescription is required", {
        lineId: l.lineId, controlledClass: l.rx.controlledClass, rxRequired: l.rx.rxRequired,
      });
    }
    const max = l.rx.maxQtyPerRxSsu;
    if (controlled && max !== undefined && l.ssuQty > max) {
      return domainErr("sales.rx_qty_exceeded", "Quantity exceeds the maximum per prescription", {
        lineId: l.lineId, maxSsu: max.toString(), ssuQty: l.ssuQty.toString(),
      });
    }
    if (l.rx.rxRequired === "RX" && !complete) out.push(warning("sales.rx_advisory", null, null, { lineId: l.lineId }));
  }
  return ok(Object.freeze(out));
}

// ------------------------------------------------------------------ credit

/** All amounts in the functional currency (conversion done by the caller with the rate snapshot). */
export interface CustomerCreditInfo {
  readonly customerId: string;
  readonly isWalkIn: boolean;
  readonly creditBlocked: boolean;
  /** 0 = cash only. */
  readonly creditLimit: Money;
  readonly outstanding: Money;
  readonly oldestOverdueDays: number;
  readonly maxOverdueDays: number | null;
}

/** FR-SAL-127/128. */
export function checkCredit(c: CustomerCreditInfo, creditPortion: Money, override?: GuardOverride): Result<readonly GuardWarning[]> {
  if (creditPortion.isNegative()) return domainErr("sales.negative_credit", "Credit portion must be >= 0");
  if (creditPortion.isZero()) return ok(Object.freeze([]));
  if (c.isWalkIn) return domainErr("sales.credit_walk_in", "Credit sales need a registered customer", { customerId: c.customerId });
  if (c.creditBlocked) return domainErr("sales.credit_blocked", "Customer is blocked from credit", { customerId: c.customerId });
  const exposure = c.outstanding.add(creditPortion);
  const specs: GuardSpec[] = [];
  if (exposure.gt(c.creditLimit)) {
    specs.push({ code: "sales.credit_limit_exceeded", message: "Credit limit exceeded", policy: "BLOCK_WITH_OVERRIDE",
      permission: SALES_PERMISSIONS.creditOverride,
      details: { customerId: c.customerId, limit: c.creditLimit.toDecimalString(), exposure: exposure.toDecimalString() } });
  }
  if (c.maxOverdueDays !== null && c.oldestOverdueDays > c.maxOverdueDays) {
    specs.push({ code: "sales.credit_overdue", message: "Customer has overdue debt", policy: "BLOCK_WITH_OVERRIDE",
      permission: SALES_PERMISSIONS.creditOverride,
      details: { customerId: c.customerId, overdueDays: c.oldestOverdueDays, maxOverdueDays: c.maxOverdueDays } });
  }
  const out: GuardWarning[] = [];
  for (const s of specs) {
    const r = evaluateGuard(s, override);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(Object.freeze(out));
}
