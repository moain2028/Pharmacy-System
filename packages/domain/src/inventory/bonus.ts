/**
 * Supplier bonus & landed cost — FR-LOT-113 and FR-INV-107 (extra receipt costs).
 *
 * Default costing (owner decision Q2): the paid total spreads over paid + bonus units — ONE lot
 * with qty = paid + bonus and totalCost = paidTotal. No "bonus profit" is recognised at receipt
 * (IAS 2). When the bonus is a different lot, the paid total is split by quantity.
 */
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { toSsu } from "../quantity/quantity.js";

export interface BonusReceipt {
  readonly qtyPaidSsu: bigint;
  readonly qtyBonusSsu: bigint;
  readonly qtyTotalSsu: bigint;
  readonly totalCostMinor: Money;
  /** Indicative per-SSU cost (Half-Up) — display only; issues are costed via Lot.costForSsu*. */
  readonly unitCostHintMinor: Money;
}

/** Golden: 10 paid + 2 bonus at 1,200.00 → one lot of 12 costing 1,200.00 (unit hint 100.00). */
export function receiptWithBonus(paidQtySsu: bigint, bonusQtySsu: bigint, paidTotal: Money): Result<BonusReceipt> {
  const paid = toSsu(paidQtySsu, { positive: true });
  if (!paid.ok) return paid;
  const bonus = toSsu(bonusQtySsu, { nonNegative: true });
  if (!bonus.ok) return bonus;
  if (paidTotal.isNegative()) {
    return domainErr("inventory.negative_cost", "Paid total must not be negative", { paidTotal: paidTotal.toString() });
  }
  const total = paid.value + bonus.value;
  return ok(
    Object.freeze({
      qtyPaidSsu: paid.value,
      qtyBonusSsu: bonus.value,
      qtyTotalSsu: total,
      totalCostMinor: paidTotal,
      unitCostHintMinor: paidTotal.divide(total),
    }),
  );
}

function ratioOf(value: bigint): Result<number> {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    return domainErr("inventory.ratio_overflow", "Value too large for proportional allocation", { value: value.toString() });
  }
  return ok(n);
}

export interface BonusSplit {
  readonly paidLotCostMinor: Money;
  readonly bonusLotCostMinor: Money;
}

/** Bonus arrives as a different lot: split the paid total by quantity (largest remainder). */
export function splitBonusAcrossLots(paidQtySsu: bigint, bonusQtySsu: bigint, paidTotal: Money): Result<BonusSplit> {
  const receipt = receiptWithBonus(paidQtySsu, bonusQtySsu, paidTotal);
  if (!receipt.ok) return receipt;
  const paidRatio = ratioOf(receipt.value.qtyPaidSsu);
  if (!paidRatio.ok) return paidRatio;
  const bonusRatio = ratioOf(receipt.value.qtyBonusSsu);
  if (!bonusRatio.ok) return bonusRatio;
  // Money.allocate returns exactly ratios.length parts.
  const parts = paidTotal.allocate([paidRatio.value, bonusRatio.value]);
  return ok(Object.freeze({ paidLotCostMinor: parts[0] as Money, bonusLotCostMinor: parts[1] as Money }));
}

export interface LandedCostLot {
  readonly lotId: string;
  readonly totalCostMinor: Money;
}

export interface LandedCostAllocation {
  readonly lotId: string;
  readonly extraCostMinor: Money;
  readonly newTotalCostMinor: Money;
}

/**
 * Spread freight/customs over lots in proportion to their cost (largest remainder, no cent lost).
 * Lots whose costs are all zero (e.g. samples) share the extra cost equally.
 */
export function landedCostAllocate(lots: readonly LandedCostLot[], extraCost: Money): Result<readonly LandedCostAllocation[]> {
  if (lots.length === 0) return domainErr("inventory.landed_cost_no_lots", "Landed cost needs at least one lot");
  const foreign = lots.find((l) => l.totalCostMinor.currency !== extraCost.currency);
  if (foreign !== undefined) {
    return domainErr("inventory.currency_mismatch", "Lot cost currency differs from extra cost", {
      lotId: foreign.lotId,
      lot: foreign.totalCostMinor.currency,
      extra: extraCost.currency,
    });
  }
  const negative = lots.find((l) => l.totalCostMinor.isNegative());
  if (negative !== undefined) {
    return domainErr("inventory.negative_cost", "Lot cost must not be negative", { lotId: negative.lotId });
  }
  const ratios: number[] = [];
  for (const l of lots) {
    const r = ratioOf(l.totalCostMinor.amountMinor);
    if (!r.ok) return r;
    ratios.push(r.value);
  }
  const effective = ratios.every((r) => r === 0) ? ratios.map(() => 1) : ratios;
  const parts = extraCost.allocate(effective);
  return ok(
    Object.freeze(
      lots.map((l, i) => {
        const part = parts[i] as Money; // allocate returns exactly lots.length parts
        return Object.freeze({ lotId: l.lotId, extraCostMinor: part, newTotalCostMinor: l.totalCostMinor.add(part) });
      }),
    ),
  );
}
