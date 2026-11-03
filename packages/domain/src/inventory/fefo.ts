/**
 * FEFO allocation — FR-LOT-103 (order), FR-LOT-104 (authorised override), FR-LOT-105 (hard block
 * on expired / blocked / quarantined), FR-INV-102 (negative stock policy).
 *
 * Pure function over a snapshot of lot balances; the application layer locks `stock_balances`
 * (SELECT ... FOR UPDATE) and re-runs this at posting time with the real business date.
 * Allocation costs are the proportional Half-Up cost (indicative); posting recomputes with
 * `Lot.costForSsuWithResidual` so a full depletion sums exactly to the lot's total cost.
 */
import type { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { toSsu } from "../quantity/quantity.js";
import { parseIsoDate, type IsoDate } from "./iso-date.js";
import { isSellableStatus, type Lot, type LotEffectiveStatus } from "./lot.js";

export const FEFO_OVERRIDE_PERMISSION = "inventory.lot_override_fefo" as const;
export type FefoOverridePermission = typeof FEFO_OVERRIDE_PERMISSION;

export interface LotBalance {
  readonly lot: Lot;
  /** on_hand − reserved for the location being issued from. */
  readonly availableSsu: bigint;
  /** ISO timestamp of first receipt — FEFO tie-break after expiry. */
  readonly receivedAt: string;
}

export interface FefoOverride {
  readonly permission: FefoOverridePermission;
  readonly approvedBy: string;
  readonly reason: string;
}

export interface FefoRequest {
  readonly itemId: string;
  readonly qtySsu: bigint;
  readonly businessDate: IsoDate;
  readonly lots: readonly LotBalance[];
  readonly overrideLotId?: string | undefined;
  readonly override?: FefoOverride | undefined;
}

export interface FefoPolicy {
  readonly allowNegativeStock: boolean;
  readonly nearExpiryDays: number;
  /** FR-LOT-105 `sale_block_days_before_expiry` (default 0 = sell until the day before expiry). */
  readonly saleBlockDaysBeforeExpiry?: number | undefined;
}

export interface Allocation {
  readonly lotId: string;
  readonly expiryDate: IsoDate;
  readonly qtySsu: bigint;
  readonly costMinor: Money;
  readonly status: LotEffectiveStatus;
  readonly viaOverride: boolean;
}

export interface FefoResult {
  readonly allocations: readonly Allocation[];
  /** > 0 only when the policy allows negative stock (application creates the PENDING lot). */
  readonly shortfallSsu: bigint;
  /** Sellable lots that FEFO would have used before the overridden lot (for `fefo_overrides`). */
  readonly skippedLotIds: readonly string[];
  readonly override: FefoOverride | null;
}

/** expiry_date ASC, receivedAt ASC, lot_id ASC (FR-LOT-103). */
export function fefoCompare(a: LotBalance, b: LotBalance): number {
  if (a.lot.expiryDate !== b.lot.expiryDate) return a.lot.expiryDate < b.lot.expiryDate ? -1 : 1;
  if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? -1 : 1;
  return a.lot.lotId < b.lot.lotId ? -1 : a.lot.lotId > b.lot.lotId ? 1 : 0;
}

interface Classified {
  readonly balance: LotBalance;
  readonly status: LotEffectiveStatus;
  readonly sellable: boolean;
}

function classify(balance: LotBalance, businessDate: IsoDate, policy: FefoPolicy): Classified {
  const status = balance.lot.effectiveStatus(businessDate, balance.availableSsu, policy.nearExpiryDays);
  const blockDays = policy.saleBlockDaysBeforeExpiry ?? 0;
  const tooShort = blockDays > 0 && balance.lot.daysToExpiry(businessDate) <= blockDays;
  return { balance, status, sellable: isSellableStatus(status) && !tooShort };
}

function validOverride(ov: FefoOverride | undefined): ov is FefoOverride {
  return (
    ov !== undefined && ov.permission === FEFO_OVERRIDE_PERMISSION && ov.approvedBy.trim() !== "" && ov.reason.trim() !== ""
  );
}

export function allocateFefo(request: FefoRequest, policy: FefoPolicy): Result<FefoResult> {
  const qty = toSsu(request.qtySsu, { positive: true });
  if (!qty.ok) return qty;
  const date = parseIsoDate(request.businessDate);
  if (!date.ok) return date;
  const foreign = request.lots.find((b) => b.lot.itemId !== request.itemId);
  if (foreign !== undefined) {
    return domainErr("inventory.item_mismatch", "All lots must belong to the requested item", {
      itemId: request.itemId,
      lotId: foreign.lot.lotId,
      lotItemId: foreign.lot.itemId,
    });
  }

  const classified = request.lots.map((b) => classify(b, date.value, policy));
  const eligible = classified.filter((c) => c.sellable).sort((a, b) => fefoCompare(a.balance, b.balance));

  let queue: readonly Classified[] = eligible;
  let skippedLotIds: readonly string[] = [];
  let override: FefoOverride | null = null;
  const overrideLotId = request.overrideLotId;
  if (overrideLotId !== undefined) {
    const chosen = classified.find((c) => c.balance.lot.lotId === overrideLotId);
    if (chosen === undefined) {
      return domainErr("inventory.lot_not_found", "Override lot is not among the item's lots", { lotId: overrideLotId });
    }
    if (chosen.balance.lot.isExpired(date.value)) {
      return domainErr("inventory.lot_expired", "Expired lots can never be issued, even with override", {
        lotId: overrideLotId,
        expiryDate: chosen.balance.lot.expiryDate,
        businessDate: date.value,
      });
    }
    if (!chosen.sellable) {
      return domainErr("inventory.lot_not_sellable", "Override lot is not in a sellable state", {
        lotId: overrideLotId,
        status: chosen.status,
      });
    }
    if (!validOverride(request.override)) {
      return domainErr("inventory.fefo_override_required", `Choosing a lot requires ${FEFO_OVERRIDE_PERMISSION} with approver and reason`, {
        lotId: overrideLotId,
        permission: FEFO_OVERRIDE_PERMISSION,
      });
    }
    override = request.override;
    skippedLotIds = eligible.slice(0, eligible.indexOf(chosen)).map((c) => c.balance.lot.lotId);
    queue = [chosen, ...eligible.filter((c) => c !== chosen)];
  }

  let remaining = qty.value;
  const allocations: Allocation[] = [];
  for (const c of queue) {
    if (remaining === 0n) break;
    const take = c.balance.availableSsu < remaining ? c.balance.availableSsu : remaining;
    const cost = c.balance.lot.costForSsu(take);
    if (!cost.ok) return cost;
    allocations.push(
      Object.freeze({
        lotId: c.balance.lot.lotId,
        expiryDate: c.balance.lot.expiryDate,
        qtySsu: take,
        costMinor: cost.value,
        status: c.status,
        viaOverride: c.balance.lot.lotId === overrideLotId,
      }),
    );
    remaining -= take;
  }

  if (remaining > 0n && !policy.allowNegativeStock) {
    const expiredSsu = classified
      .filter((c) => c.status === "EXPIRED")
      .reduce((acc, c) => acc + c.balance.availableSsu, 0n);
    return domainErr("inventory.insufficient_stock", `Insufficient sellable stock for item ${request.itemId}`, {
      itemId: request.itemId,
      requestedSsu: qty.value.toString(),
      allocatedSsu: (qty.value - remaining).toString(),
      shortfallSsu: remaining.toString(),
      expiredSsu: expiredSsu.toString(),
    });
  }

  return ok(
    Object.freeze({
      allocations: Object.freeze(allocations),
      shortfallSsu: remaining,
      skippedLotIds: Object.freeze([...skippedLotIds]),
      override,
    }),
  );
}
