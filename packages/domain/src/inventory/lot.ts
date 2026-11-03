/**
 * Lot aggregate — FR-LOT-101 (immutable receipt facts), FR-LOT-102 (state machine),
 * FR-INV-107 (per-lot specific-identification costing).
 *
 * Decisions:
 *  - Dates are ISO "YYYY-MM-DD" strings (see iso-date.ts). A lot is EXPIRED from the START of its
 *    expiry date: `expiryDate <= businessDate` (owner decision Q4 — not sold on the expiry day).
 *  - No unit cost is stored. `totalCostMinor` covers `qtyReceivedSsu`; the cost of an issue is
 *    Half-Up proportional and the residual rides on the last unit out so that the costs of a full
 *    depletion sum to `totalCostMinor` exactly (costForSsuWithResidual / costSchedule).
 *  - Manual statuses change only through documents; `applyManualStatus` returns a NEW frozen Lot.
 *  - DEPLETED (available <= 0) wins over NEAR_EXPIRY: a lot with no stock is never "near expiry"
 *    for alerting (spec §4.12: zero-stock lots never appear in expiry alerts).
 */
import { Money, divHalfUp } from "../money/money.js";
import { DomainError, domainErr, ok, type Result } from "../shared/result.js";
import { toSsu } from "../quantity/quantity.js";
import { assertIsoDate, daysBetween, parseIsoDate, type IsoDate } from "./iso-date.js";

export const LOT_SOURCE_TYPES = ["OFFICIAL", "PARALLEL"] as const;
export type LotSourceType = (typeof LOT_SOURCE_TYPES)[number];
export function isLotSourceType(x: unknown): x is LotSourceType {
  return typeof x === "string" && (LOT_SOURCE_TYPES as readonly string[]).includes(x);
}

export const LOT_MANUAL_STATUSES = ["NONE", "QUARANTINED", "BLOCKED", "RETURNED_TO_SUPPLIER", "DESTROYED"] as const;
export type LotManualStatus = (typeof LOT_MANUAL_STATUSES)[number];
export function isLotManualStatus(x: unknown): x is LotManualStatus {
  return typeof x === "string" && (LOT_MANUAL_STATUSES as readonly string[]).includes(x);
}

export const LOT_EFFECTIVE_STATUSES = [
  "AVAILABLE",
  "NEAR_EXPIRY",
  "EXPIRED",
  "QUARANTINED",
  "BLOCKED",
  "RETURNED_TO_SUPPLIER",
  "DESTROYED",
  "DEPLETED",
] as const;
export type LotEffectiveStatus = (typeof LOT_EFFECTIVE_STATUSES)[number];

/** Statuses from which stock may be issued to a sale/transfer (FR-LOT-103). */
export const SELLABLE_LOT_STATUSES: readonly LotEffectiveStatus[] = Object.freeze(["AVAILABLE", "NEAR_EXPIRY"]);
export function isSellableStatus(status: LotEffectiveStatus): boolean {
  return SELLABLE_LOT_STATUSES.includes(status);
}

export const LOT_NUMBER_MAX_LENGTH = 50;
/** FR-LOT-101: lot numbers are compared as UPPER(TRIM()). */
export function normalizeLotNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

/** FR-LOT-102 allowed manual transitions. */
const MANUAL_TRANSITIONS: Readonly<Record<LotManualStatus, readonly LotManualStatus[]>> = Object.freeze({
  NONE: ["QUARANTINED", "BLOCKED"] as const,
  QUARANTINED: ["NONE", "RETURNED_TO_SUPPLIER", "DESTROYED"] as const,
  BLOCKED: ["QUARANTINED", "RETURNED_TO_SUPPLIER", "DESTROYED"] as const,
  RETURNED_TO_SUPPLIER: [] as const,
  DESTROYED: [] as const,
});
/** From effective EXPIRED (manual NONE + expiry reached) only these outcomes are allowed. */
const EXPIRED_TRANSITIONS: readonly LotManualStatus[] = ["RETURNED_TO_SUPPLIER", "DESTROYED"];

export interface LotProps {
  readonly lotId: string;
  readonly itemId: string;
  readonly lotNumber: string;
  /** ISO "YYYY-MM-DD"; items without expiry tracking use 9999-12-31 (see expiry-alerts.ts). */
  readonly expiryDate: IsoDate;
  readonly qtyReceivedSsu: bigint;
  readonly totalCostMinor: Money;
  readonly sourceType: LotSourceType;
  readonly supplierId?: string | undefined;
  readonly printedPublicPriceMinor?: Money | undefined;
  readonly manualStatus?: LotManualStatus | undefined;
}

interface LotState {
  readonly lotId: string;
  readonly itemId: string;
  readonly lotNumber: string;
  readonly expiryDate: IsoDate;
  readonly qtyReceivedSsu: bigint;
  readonly totalCostMinor: Money;
  readonly sourceType: LotSourceType;
  readonly supplierId: string | undefined;
  readonly printedPublicPriceMinor: Money | undefined;
  readonly manualStatus: LotManualStatus;
}

export class Lot {
  readonly lotId: string;
  readonly itemId: string;
  readonly lotNumber: string;
  readonly expiryDate: IsoDate;
  readonly qtyReceivedSsu: bigint;
  readonly totalCostMinor: Money;
  readonly sourceType: LotSourceType;
  readonly supplierId: string | undefined;
  readonly printedPublicPriceMinor: Money | undefined;
  readonly manualStatus: LotManualStatus;

  private constructor(s: LotState) {
    this.lotId = s.lotId;
    this.itemId = s.itemId;
    this.lotNumber = s.lotNumber;
    this.expiryDate = s.expiryDate;
    this.qtyReceivedSsu = s.qtyReceivedSsu;
    this.totalCostMinor = s.totalCostMinor;
    this.sourceType = s.sourceType;
    this.supplierId = s.supplierId;
    this.printedPublicPriceMinor = s.printedPublicPriceMinor;
    this.manualStatus = s.manualStatus;
    Object.freeze(this);
  }

  /** Build (or rehydrate) a lot; validates every invariant of FR-LOT-101. */
  static create(props: LotProps): Result<Lot> {
    if (props.lotId.trim() === "" || props.itemId.trim() === "") {
      return domainErr("inventory.lot_identity_required", "lotId and itemId are required", {
        lotId: props.lotId,
        itemId: props.itemId,
      });
    }
    const lotNumber = normalizeLotNumber(props.lotNumber);
    if (lotNumber === "") {
      return domainErr("inventory.lot_number_required", "Lot number is required", { lotId: props.lotId });
    }
    if (lotNumber.length > LOT_NUMBER_MAX_LENGTH) {
      return domainErr("inventory.lot_number_too_long", `Lot number exceeds ${LOT_NUMBER_MAX_LENGTH} chars`, {
        lotNumber,
        max: LOT_NUMBER_MAX_LENGTH,
      });
    }
    const expiry = parseIsoDate(props.expiryDate);
    if (!expiry.ok) return expiry;
    const qty = toSsu(props.qtyReceivedSsu, { positive: true });
    if (!qty.ok) return qty;
    if (!isLotSourceType(props.sourceType)) {
      return domainErr("inventory.unknown_source_type", "Unknown lot source type", { sourceType: props.sourceType });
    }
    const manualStatus = props.manualStatus ?? "NONE";
    if (!isLotManualStatus(manualStatus)) {
      return domainErr("inventory.unknown_manual_status", "Unknown manual status", { manualStatus });
    }
    if (props.totalCostMinor.isNegative()) {
      return domainErr("inventory.negative_cost", "Lot total cost must not be negative", {
        totalCostMinor: props.totalCostMinor.toString(),
      });
    }
    const printed = props.printedPublicPriceMinor;
    if (printed !== undefined) {
      if (printed.currency !== props.totalCostMinor.currency) {
        return domainErr("inventory.currency_mismatch", "Printed public price currency differs from lot cost", {
          cost: props.totalCostMinor.currency,
          printed: printed.currency,
        });
      }
      if (printed.isNegative()) {
        return domainErr("inventory.negative_printed_price", "Printed public price must not be negative", {
          printed: printed.toString(),
        });
      }
    }
    return ok(
      new Lot({
        lotId: props.lotId,
        itemId: props.itemId,
        lotNumber,
        expiryDate: expiry.value,
        qtyReceivedSsu: qty.value,
        totalCostMinor: props.totalCostMinor,
        sourceType: props.sourceType,
        supplierId: props.supplierId,
        printedPublicPriceMinor: printed,
        manualStatus,
      }),
    );
  }

  private state(): LotState {
    return {
      lotId: this.lotId,
      itemId: this.itemId,
      lotNumber: this.lotNumber,
      expiryDate: this.expiryDate,
      qtyReceivedSsu: this.qtyReceivedSsu,
      totalCostMinor: this.totalCostMinor,
      sourceType: this.sourceType,
      supplierId: this.supplierId,
      printedPublicPriceMinor: this.printedPublicPriceMinor,
      manualStatus: this.manualStatus,
    };
  }

  /** Expired from the start of the expiry date (Q4): expiry <= businessDate. */
  isExpired(businessDate: IsoDate): boolean {
    return this.expiryDate <= assertIsoDate(businessDate);
  }

  /** Days until expiry (negative when already expired). */
  daysToExpiry(businessDate: IsoDate): number {
    return daysBetween(assertIsoDate(businessDate), this.expiryDate);
  }

  /**
   * FR-LOT-102 precedence: DESTROYED > RETURNED_TO_SUPPLIER > BLOCKED > QUARANTINED > EXPIRED >
   * DEPLETED (available <= 0) > NEAR_EXPIRY (days <= nearExpiryDays) > AVAILABLE.
   */
  effectiveStatus(businessDate: IsoDate, availableSsu: bigint, nearExpiryDays: number): LotEffectiveStatus {
    if (!Number.isSafeInteger(nearExpiryDays) || nearExpiryDays < 0) {
      throw new DomainError("inventory.bad_near_expiry_days", "nearExpiryDays must be a non-negative integer", {
        nearExpiryDays,
      });
    }
    const manual = this.manualStatus;
    if (manual !== "NONE") return manual;
    if (this.isExpired(businessDate)) return "EXPIRED";
    if (availableSsu <= 0n) return "DEPLETED";
    if (this.daysToExpiry(businessDate) <= nearExpiryDays) return "NEAR_EXPIRY";
    return "AVAILABLE";
  }

  /** FR-LOT-102 manual transitions; the EXPIRED→(RETURNED|DESTROYED) path needs the business date. */
  applyManualStatus(to: LotManualStatus, businessDate: IsoDate): Result<Lot> {
    const direct = MANUAL_TRANSITIONS[this.manualStatus].includes(to);
    const viaExpired =
      this.manualStatus === "NONE" && EXPIRED_TRANSITIONS.includes(to) && this.isExpired(businessDate);
    if (!direct && !viaExpired) {
      return domainErr("inventory.lot_invalid_transition", `Lot cannot move from ${this.manualStatus} to ${to}`, {
        lotId: this.lotId,
        from: this.manualStatus,
        to,
        specCode: "LOT_INVALID_TRANSITION",
      });
    }
    return ok(new Lot({ ...this.state(), manualStatus: to }));
  }

  /** Indicative per-SSU cost (Half-Up) for display — never used for posting. */
  unitCostHint(): Money {
    return this.totalCostMinor.divide(this.qtyReceivedSsu);
  }

  /** Proportional Half-Up cost of `qtySsu` units: round(total × qty / received). Also lot valuation. */
  costForSsu(qtySsu: bigint): Result<Money> {
    const q = toSsu(qtySsu, { nonNegative: true });
    if (!q.ok) return q;
    if (q.value > this.qtyReceivedSsu) return this.exceeds(q.value);
    return ok(this.proportional(q.value));
  }

  /**
   * Cost of an issue of `qtySsu` when `remainingBeforeSsu` units (carrying `remainingCostBefore`)
   * are left in the lot. The last unit out takes the whole remaining cost, so Σ issues == total.
   * Intermediate issues never exceed the remaining cost (clamp), keeping every cost >= 0.
   */
  costForSsuWithResidual(qtySsu: bigint, remainingBeforeSsu: bigint, remainingCostBefore: Money): Result<Money> {
    const q = toSsu(qtySsu, { positive: true });
    if (!q.ok) return q;
    const rem = toSsu(remainingBeforeSsu, { positive: true });
    if (!rem.ok) return rem;
    if (rem.value > this.qtyReceivedSsu || q.value > rem.value) return this.exceeds(q.value, rem.value);
    if (remainingCostBefore.currency !== this.totalCostMinor.currency) {
      return domainErr("inventory.currency_mismatch", "Remaining cost currency differs from lot cost", {
        lot: this.totalCostMinor.currency,
        remaining: remainingCostBefore.currency,
      });
    }
    if (remainingCostBefore.isNegative() || remainingCostBefore.gt(this.totalCostMinor)) {
      return domainErr("inventory.remaining_cost_out_of_range", "Remaining cost must be within [0, totalCost]", {
        remaining: remainingCostBefore.toString(),
        total: this.totalCostMinor.toString(),
      });
    }
    if (q.value === rem.value) return ok(remainingCostBefore);
    return ok(Money.min(this.proportional(q.value), remainingCostBefore));
  }

  /** Cost of each issue in sequence, starting from a full lot (FR-INV-107 golden path). */
  costSchedule(issuesSsu: readonly bigint[]): Result<readonly Money[]> {
    let remaining = this.qtyReceivedSsu;
    let remainingCost = this.totalCostMinor;
    const out: Money[] = [];
    for (const issue of issuesSsu) {
      const c = this.costForSsuWithResidual(issue, remaining, remainingCost);
      if (!c.ok) return c;
      out.push(c.value);
      remaining -= issue;
      remainingCost = remainingCost.subtract(c.value);
    }
    return ok(Object.freeze(out));
  }

  private proportional(qty: bigint): Money {
    return Money.minor(divHalfUp(this.totalCostMinor.amountMinor * qty, this.qtyReceivedSsu), this.totalCostMinor.currency);
  }

  private exceeds(qty: bigint, remaining?: bigint): Result<never> {
    return domainErr("inventory.qty_exceeds_lot", "Quantity exceeds the lot's quantity", {
      lotId: this.lotId,
      qtySsu: qty.toString(),
      remainingBeforeSsu: remaining === undefined ? null : remaining.toString(),
      qtyReceivedSsu: this.qtyReceivedSsu.toString(),
    });
  }
}
