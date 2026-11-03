/**
 * Quantity & unit conversion — ENGINEERING-RULES A2 and D-026 (Flexible UOM).
 *
 * Stock is ALWAYS stored as an integer count of the Smallest Sellable Unit (SSU).
 * Every item defines its own unit ladder (e.g. carton=10 boxes, box=3 strips, strip=10 tablets).
 * `factorToSsu` for a unit = how many SSU one such unit contains (SSU itself = 1).
 * Fractions are never allowed in documents (D-026). factorToSsu is locked after the first
 * stock movement touches the unit — enforced in the application/DB layer; here we just model it.
 */
import { DomainError, domainErr, ok, type Result } from "../shared/result.js";

export type Ssu = bigint; // branded by convention: counts in smallest sellable unit

export interface ItemUnit {
  readonly unitId: string;
  readonly itemId: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly factorToSsu: bigint; // >= 1 ; exactly one unit per item has 1 (the SSU)
  readonly level: number; // 1 = largest
  readonly isSsu: boolean;
  readonly canSell: boolean;
  readonly canPurchase: boolean;
  readonly active: boolean;
}

/** Snapshot stored on every document line so history survives later ladder changes. */
export interface UnitSnapshot {
  readonly unitId: string;
  readonly unitNameAr: string;
  readonly unitNameEn: string;
  readonly factorSnapshot: bigint;
  readonly qtyInUnit: bigint;
  readonly ssuQty: bigint; // = qtyInUnit × factorSnapshot
}

function isIntegerLike(x: unknown): x is bigint | number | string {
  if (typeof x === "bigint") return true;
  if (typeof x === "number") return Number.isSafeInteger(x);
  if (typeof x === "string") return /^[+-]?\d+$/.test(x.trim());
  return false;
}

/** Validate & build an SSU quantity (integer, may be negative for deltas unless `nonNegative`). */
export function toSsu(x: unknown, opts: { nonNegative?: boolean; positive?: boolean } = {}): Result<Ssu> {
  if (!isIntegerLike(x)) {
    return domainErr("qty.non_integer", "Quantity must be an integer (no fractions)", { value: String(x) });
  }
  const v = BigInt(x);
  if (opts.positive && v <= 0n) return domainErr("qty.not_positive", "Quantity must be > 0", { value: v.toString() });
  if (opts.nonNegative && v < 0n) return domainErr("qty.negative", "Quantity must be >= 0", { value: v.toString() });
  return ok(v);
}

/**
 * Validate a unit ladder for one item (D-026):
 *  - exactly one SSU unit with factor 1
 *  - all factors >= 1, integers
 *  - factors strictly decrease as level increases (larger units contain more SSU)
 *  - each larger unit's factor is a multiple of the next smaller unit's factor
 *    (carton 30 → box 10 → strip 1 OK; carton 25 → box 10 NOT OK: a carton must be whole boxes)
 */
export function validateUnitLadder(units: readonly ItemUnit[]): Result<readonly ItemUnit[]> {
  if (units.length === 0) return domainErr("uom.empty_ladder", "An item needs at least one unit (the SSU)");
  const ssu = units.filter((u) => u.isSsu);
  if (ssu.length !== 1) return domainErr("uom.ssu_count", "Exactly one unit must be the SSU", { count: ssu.length });
  if ((ssu[0] as ItemUnit).factorToSsu !== 1n) return domainErr("uom.ssu_factor", "SSU factor must be 1");
  for (const u of units) {
    if (u.factorToSsu < 1n) return domainErr("uom.bad_factor", "factorToSsu must be >= 1", { unitId: u.unitId });
  }
  const sorted = [...units].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length - 1; i++) {
    const big = sorted[i] as ItemUnit;
    const small = sorted[i + 1] as ItemUnit;
    if (big.level === small.level) return domainErr("uom.duplicate_level", "Unit levels must be unique", { level: big.level });
    if (big.factorToSsu <= small.factorToSsu) {
      return domainErr("uom.not_descending", "Larger units must contain more SSU than smaller ones", {
        big: big.unitId, small: small.unitId,
      });
    }
    if (big.factorToSsu % small.factorToSsu !== 0n) {
      return domainErr("uom.not_multiple", "A larger unit must be a whole multiple of the next smaller unit", {
        big: big.unitId, small: small.unitId, bigFactor: big.factorToSsu.toString(), smallFactor: small.factorToSsu.toString(),
      });
    }
  }
  // Strictly descending factors + exactly one factor-1 SSU ⇒ the SSU is necessarily the last level.
  return ok(units);
}

/** qty in a given unit → SSU. Integer only. */
export function toSsuQty(qtyInUnit: bigint, unit: Pick<ItemUnit, "factorToSsu">): Ssu {
  return qtyInUnit * unit.factorToSsu;
}

/** Build the immutable line snapshot (D-026). */
export function snapshotUnit(unit: ItemUnit, qtyInUnit: bigint): Result<UnitSnapshot> {
  if (qtyInUnit <= 0n) return domainErr("qty.not_positive", "Line quantity must be > 0", { qty: qtyInUnit.toString() });
  if (!unit.active) return domainErr("uom.inactive", "Unit is inactive", { unitId: unit.unitId });
  return ok(
    Object.freeze({
      unitId: unit.unitId,
      unitNameAr: unit.nameAr,
      unitNameEn: unit.nameEn,
      factorSnapshot: unit.factorToSsu,
      qtyInUnit,
      ssuQty: toSsuQty(qtyInUnit, unit),
    }),
  );
}

/**
 * Express an SSU quantity in the item's ladder, largest unit first (for display: "2 كرتون + 3 علب + 4 شريط").
 * Returns parts in descending level order; zero parts omitted except when total is 0 (one SSU part of 0).
 */
export function decomposeSsu(ssuQty: Ssu, units: readonly ItemUnit[]): { unit: ItemUnit; qty: bigint }[] {
  if (ssuQty < 0n) throw new DomainError("qty.negative", "Cannot decompose negative quantity");
  const sorted = [...units].filter((u) => u.active || u.isSsu).sort((a, b) => a.level - b.level);
  const parts: { unit: ItemUnit; qty: bigint }[] = [];
  let rest = ssuQty;
  for (const u of sorted) {
    const q = rest / u.factorToSsu;
    if (q > 0n) {
      parts.push({ unit: u, qty: q });
      rest -= q * u.factorToSsu;
    }
  }
  if (parts.length === 0) {
    const ssu = sorted.find((u) => u.isSsu);
    if (!ssu) throw new DomainError("uom.ssu_missing", "ladder has no SSU");
    parts.push({ unit: ssu, qty: 0n });
  }
  return parts;
}

/**
 * Convert a per-SSU price/cost to a per-unit figure: price_unit = price_ssu × factor.
 * (Inverse direction — unit→SSU — divides with Half-Up and is done in the pricing module, since
 *  per-SSU prices may need sub-minor precision; keep that decision explicit there.)
 */
export function scaleBySsuFactor<T extends { multiply(q: bigint): T }>(perSsu: T, unit: Pick<ItemUnit, "factorToSsu">): T {
  return perSsu.multiply(unit.factorToSsu);
}
