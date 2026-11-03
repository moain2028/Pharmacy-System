/**
 * Expiry tiers & worklist — FR-LOT-106.
 * Tiers are "days before expiry" thresholds (default 180/90/30). A lot falls into the smallest
 * tier whose threshold >= days-to-expiry; `EXPIRED` when days <= 0 (Q4); `OK` beyond all tiers.
 * Zero-stock, destroyed/returned and no-expiry (9999-12-31) lots never appear in the worklist.
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { assertIsoDate, compareIsoDate, daysBetween, parseIsoDate, type IsoDate } from "./iso-date.js";
import type { Lot } from "./lot.js";

export const DEFAULT_EXPIRY_TIERS: readonly number[] = Object.freeze([180, 90, 30]);
/** Sentinel stored for items with `track_expiry = false` (FR-LOT-101). */
export const NO_EXPIRY_DATE: IsoDate = "9999-12-31";

export type ExpiryTierLabel = "EXPIRED" | "OK" | `WITHIN_${number}D`;

export function tierLabel(daysBefore: number): ExpiryTierLabel {
  return `WITHIN_${daysBefore}D`;
}

/** Tiers must be positive integers, unique; returned sorted descending (frozen). */
export function validateExpiryTiers(tiers: readonly number[]): Result<readonly number[]> {
  if (tiers.length === 0) return domainErr("inventory.expiry_tiers_empty", "At least one expiry tier is required");
  const bad = tiers.find((t) => !Number.isSafeInteger(t) || t <= 0);
  if (bad !== undefined) {
    return domainErr("inventory.expiry_tier_invalid", "Expiry tiers must be positive integers (days)", { tier: bad });
  }
  if (new Set(tiers).size !== tiers.length) {
    return domainErr("inventory.expiry_tiers_duplicate", "Expiry tiers must be unique", { tiers: [...tiers] });
  }
  return ok(Object.freeze([...tiers].sort((a, b) => b - a)));
}

function classifyDays(days: number, tiersDesc: readonly number[]): ExpiryTierLabel {
  if (days <= 0) return "EXPIRED";
  let label: ExpiryTierLabel = "OK";
  for (const t of tiersDesc) if (days <= t) label = tierLabel(t);
  return label;
}

/** Throws on invalid tiers/dates (configuration is validated at the boundary via validateExpiryTiers). */
export function classifyExpiry(expiryDate: IsoDate, businessDate: IsoDate, tiers: readonly number[] = DEFAULT_EXPIRY_TIERS): ExpiryTierLabel {
  const valid = validateExpiryTiers(tiers);
  if (!valid.ok) throw valid.error;
  return classifyDays(daysBetween(assertIsoDate(businessDate), assertIsoDate(expiryDate)), valid.value);
}

export interface LotStock {
  readonly lot: Lot;
  readonly onHandSsu: bigint;
}

export interface ExpiryWorklistEntry {
  readonly tier: ExpiryTierLabel;
  readonly lotId: string;
  readonly itemId: string;
  readonly lotNumber: string;
  readonly expiryDate: IsoDate;
  readonly daysToExpiry: number;
  readonly onHandSsu: bigint;
  /** Remaining cost of the on-hand quantity (FR-INV-107 valuation). */
  readonly valueAtRiskMinor: Money;
}

export interface ExpiryWorklistGroup {
  readonly tier: ExpiryTierLabel;
  readonly daysBefore: number | null;
  readonly lots: readonly ExpiryWorklistEntry[];
  readonly lotCount: number;
  readonly itemCount: number;
  readonly qtySsu: bigint;
  readonly valueAtRiskMinor: Money;
}

export interface ExpiryWorklist {
  readonly businessDate: IsoDate;
  readonly currency: CurrencyCode;
  /** EXPIRED first, then tiers from most to least urgent. */
  readonly groups: readonly ExpiryWorklistGroup[];
}

function compareEntries(a: ExpiryWorklistEntry, b: ExpiryWorklistEntry): number {
  return (
    compareIsoDate(a.expiryDate, b.expiryDate) ||
    b.valueAtRiskMinor.compare(a.valueAtRiskMinor) ||
    (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0)
  );
}

export function expiryWorklist(
  stock: readonly LotStock[],
  businessDate: IsoDate,
  currency: CurrencyCode,
  tiers: readonly number[] = DEFAULT_EXPIRY_TIERS,
): Result<ExpiryWorklist> {
  const valid = validateExpiryTiers(tiers);
  if (!valid.ok) return valid;
  const date = parseIsoDate(businessDate);
  if (!date.ok) return date;

  const entries: ExpiryWorklistEntry[] = [];
  for (const s of stock) {
    if (s.onHandSsu <= 0n) continue;
    if (s.lot.expiryDate === NO_EXPIRY_DATE) continue;
    if (s.lot.manualStatus === "DESTROYED" || s.lot.manualStatus === "RETURNED_TO_SUPPLIER") continue;
    if (s.lot.totalCostMinor.currency !== currency) {
      return domainErr("inventory.currency_mismatch", "Lot cost currency differs from worklist currency", {
        lotId: s.lot.lotId,
        lot: s.lot.totalCostMinor.currency,
        worklist: currency,
      });
    }
    const days = daysBetween(date.value, s.lot.expiryDate);
    const tier = classifyDays(days, valid.value);
    if (tier === "OK") continue;
    const value = s.lot.costForSsu(s.onHandSsu);
    if (!value.ok) return value;
    entries.push(
      Object.freeze({
        tier,
        lotId: s.lot.lotId,
        itemId: s.lot.itemId,
        lotNumber: s.lot.lotNumber,
        expiryDate: s.lot.expiryDate,
        daysToExpiry: days,
        onHandSsu: s.onHandSsu,
        valueAtRiskMinor: value.value,
      }),
    );
  }

  const defs: { tier: ExpiryTierLabel; daysBefore: number | null }[] = [
    { tier: "EXPIRED", daysBefore: null },
    ...[...valid.value].reverse().map((t) => ({ tier: tierLabel(t), daysBefore: t })),
  ];
  const groups = defs.map((d) => {
    const lots = entries.filter((e) => e.tier === d.tier).sort(compareEntries);
    return Object.freeze({
      tier: d.tier,
      daysBefore: d.daysBefore,
      lots: Object.freeze(lots),
      lotCount: lots.length,
      itemCount: new Set(lots.map((l) => l.itemId)).size,
      qtySsu: lots.reduce((acc, l) => acc + l.onHandSsu, 0n),
      valueAtRiskMinor: Money.sum(
        lots.map((l) => l.valueAtRiskMinor),
        currency,
      ),
    });
  });
  return ok(Object.freeze({ businessDate: date.value, currency, groups: Object.freeze(groups) }));
}
