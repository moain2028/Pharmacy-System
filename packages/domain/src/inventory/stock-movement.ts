/**
 * StockMovement — FR-INV-101 append-only ledger fact. Never updated or deleted; corrections are
 * new movements with the opposite sign and `reversalOfId`. `stock_balances` are derived
 * (deriveBalances) and rebuildable; the Kardex (FR-INV-108) is a running view over the facts.
 *
 * Sign rules per type: RECEIPT/SALE_RETURN/TRANSFER_IN/OPENING must be > 0; SALE/PURCHASE_RETURN/
 * TRANSFER_OUT must be < 0; ADJUSTMENT/STOCKTAKE may be either but never 0.
 */
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { toSsu } from "../quantity/quantity.js";
import { parseIsoDate, type IsoDate } from "./iso-date.js";

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "SALE",
  "SALE_RETURN",
  "PURCHASE_RETURN",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "STOCKTAKE",
  "OPENING",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export function isMovementType(x: unknown): x is MovementType {
  return typeof x === "string" && (MOVEMENT_TYPES as readonly string[]).includes(x);
}

export type MovementDirection = "IN" | "OUT" | "ANY";
export const MOVEMENT_DIRECTION: Readonly<Record<MovementType, MovementDirection>> = Object.freeze({
  RECEIPT: "IN",
  SALE: "OUT",
  SALE_RETURN: "IN",
  PURCHASE_RETURN: "OUT",
  ADJUSTMENT: "ANY",
  TRANSFER_OUT: "OUT",
  TRANSFER_IN: "IN",
  STOCKTAKE: "ANY",
  OPENING: "IN",
});

export interface DocumentRef {
  readonly docType: string;
  readonly docId: string;
  readonly lineId?: string | undefined;
}

export interface StockMovementProps {
  readonly movementId: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly locationId: string;
  readonly type: MovementType;
  readonly qtyDeltaSsu: bigint;
  /** Per-SSU cost at the time of the movement (indicative). */
  readonly unitCostSnapshot: Money;
  /** Exact cost of the moved quantity (FR-INV-107 residual rule). Defaults to unitCost × |qty|. */
  readonly costMinor?: Money | undefined;
  readonly documentRef: DocumentRef;
  /** ISO timestamp of posting (any offset accepted; stored normalised to UTC). */
  readonly occurredAt: string;
  readonly businessDate: IsoDate;
  readonly reversalOfId?: string | undefined;
  readonly note?: string | undefined;
}

export interface NegativeStockPolicy {
  readonly allowNegativeStock: boolean;
}
export const DEFAULT_NEGATIVE_STOCK_POLICY: NegativeStockPolicy = Object.freeze({ allowNegativeStock: false });

export class StockMovement {
  readonly movementId: string;
  readonly itemId: string;
  readonly lotId: string;
  readonly locationId: string;
  readonly type: MovementType;
  readonly qtyDeltaSsu: bigint;
  readonly unitCostSnapshot: Money;
  readonly costMinor: Money;
  readonly documentRef: DocumentRef;
  readonly occurredAt: string;
  readonly businessDate: IsoDate;
  readonly reversalOfId: string | undefined;
  readonly note: string | undefined;

  private constructor(p: StockMovementProps, costMinor: Money, occurredAt: string) {
    this.movementId = p.movementId;
    this.itemId = p.itemId;
    this.lotId = p.lotId;
    this.locationId = p.locationId;
    this.type = p.type;
    this.qtyDeltaSsu = p.qtyDeltaSsu;
    this.unitCostSnapshot = p.unitCostSnapshot;
    this.costMinor = costMinor;
    this.documentRef = Object.freeze({ docType: p.documentRef.docType, docId: p.documentRef.docId, lineId: p.documentRef.lineId });
    this.occurredAt = occurredAt;
    this.businessDate = p.businessDate;
    this.reversalOfId = p.reversalOfId;
    this.note = p.note;
    Object.freeze(this);
  }

  static create(p: StockMovementProps): Result<StockMovement> {
    if (!isMovementType(p.type)) {
      return domainErr("inventory.unknown_movement_type", "Unknown stock movement type", { type: p.type });
    }
    const qty = toSsu(p.qtyDeltaSsu);
    if (!qty.ok) return qty;
    if (qty.value === 0n) {
      return domainErr("inventory.zero_movement", "A stock movement must change the quantity", { movementId: p.movementId });
    }
    const direction = MOVEMENT_DIRECTION[p.type];
    if ((direction === "IN" && qty.value < 0n) || (direction === "OUT" && qty.value > 0n)) {
      return domainErr("inventory.movement_sign", `${p.type} movements must be ${direction === "IN" ? "positive" : "negative"}`, {
        type: p.type,
        qtyDeltaSsu: qty.value.toString(),
      });
    }
    if (p.unitCostSnapshot.isNegative()) {
      return domainErr("inventory.negative_cost", "Unit cost snapshot must not be negative", {
        unitCost: p.unitCostSnapshot.toString(),
      });
    }
    const absQty = qty.value < 0n ? -qty.value : qty.value;
    let cost: Money;
    if (p.costMinor === undefined) {
      cost = p.unitCostSnapshot.multiply(absQty);
    } else {
      if (p.costMinor.currency !== p.unitCostSnapshot.currency) {
        return domainErr("inventory.currency_mismatch", "costMinor currency differs from unit cost", {
          cost: p.costMinor.currency,
          unitCost: p.unitCostSnapshot.currency,
        });
      }
      if (p.costMinor.isNegative()) {
        return domainErr("inventory.negative_cost", "Movement cost must not be negative", { cost: p.costMinor.toString() });
      }
      cost = p.costMinor;
    }
    if (p.documentRef.docType.trim() === "" || p.documentRef.docId.trim() === "") {
      return domainErr("inventory.document_ref_required", "Every movement must reference a document (B3)", {
        movementId: p.movementId,
      });
    }
    const ts = Date.parse(p.occurredAt);
    if (Number.isNaN(ts)) {
      return domainErr("inventory.invalid_timestamp", "occurredAt must be an ISO timestamp", { occurredAt: p.occurredAt });
    }
    const bd = parseIsoDate(p.businessDate);
    if (!bd.ok) return bd;
    return ok(new StockMovement(p, cost, new Date(ts).toISOString()));
  }

  get absQtySsu(): bigint {
    return this.qtyDeltaSsu < 0n ? -this.qtyDeltaSsu : this.qtyDeltaSsu;
  }

  isInbound(): boolean {
    return this.qtyDeltaSsu > 0n;
  }

  /** Cost with the movement's sign: value entering (+) or leaving (−) inventory. */
  signedCostMinor(): Money {
    return this.isInbound() ? this.costMinor : this.costMinor.negate();
  }
}

export function movementKey(m: Pick<StockMovement, "itemId" | "lotId" | "locationId">): string {
  return `${m.itemId}|${m.lotId}|${m.locationId}`;
}

/** business_date ASC, occurredAt ASC, movementId ASC (spec §4.14: Kardex follows business date). */
export function compareChronologically(a: StockMovement, b: StockMovement): number {
  if (a.businessDate !== b.businessDate) return a.businessDate < b.businessDate ? -1 : 1;
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  return a.movementId < b.movementId ? -1 : a.movementId > b.movementId ? 1 : 0;
}

export function sortChronologically(movements: readonly StockMovement[]): StockMovement[] {
  return [...movements].sort(compareChronologically);
}

/** Rebuild balances per (item, lot, location); fails if any key dips below zero unless allowed. */
export function deriveBalances(
  movements: readonly StockMovement[],
  policy: NegativeStockPolicy = DEFAULT_NEGATIVE_STOCK_POLICY,
): Result<ReadonlyMap<string, bigint>> {
  const balances = new Map<string, bigint>();
  for (const m of sortChronologically(movements)) {
    const key = movementKey(m);
    const next = (balances.get(key) ?? 0n) + m.qtyDeltaSsu;
    if (next < 0n && !policy.allowNegativeStock) {
      return domainErr("inventory.negative_balance", `Movement ${m.movementId} would drive ${key} below zero`, {
        movementId: m.movementId,
        key,
        balanceSsu: next.toString(),
      });
    }
    balances.set(key, next);
  }
  return ok(balances);
}

/** Balance of a single (item, lot, location) key. */
export function deriveBalance(
  movements: readonly StockMovement[],
  policy: NegativeStockPolicy = DEFAULT_NEGATIVE_STOCK_POLICY,
): Result<bigint> {
  if (movements.length === 0) return ok(0n);
  const all = deriveBalances(movements, policy);
  if (!all.ok) return all;
  if (all.value.size !== 1) {
    return domainErr("inventory.mixed_movement_keys", "deriveBalance expects movements of one item/lot/location", {
      keys: [...all.value.keys()],
    });
  }
  let total = 0n;
  for (const v of all.value.values()) total += v;
  return ok(total);
}

export interface KardexOptions {
  readonly openingBalanceSsu?: bigint | undefined;
  readonly openingValueMinor?: Money | undefined;
  readonly allowNegativeStock?: boolean | undefined;
}

export interface KardexRow {
  readonly movement: StockMovement;
  readonly qtyInSsu: bigint;
  readonly qtyOutSsu: bigint;
  readonly balanceSsu: bigint;
  readonly costMinor: Money;
  readonly balanceValueMinor: Money;
}

/** FR-INV-108: running quantity and value for one item (any lots/locations the caller filtered). */
export function kardex(movements: readonly StockMovement[], opts: KardexOptions = {}): Result<readonly KardexRow[]> {
  const first = movements[0];
  if (first === undefined) return ok([]);
  const foreign = movements.find((m) => m.itemId !== first.itemId);
  if (foreign !== undefined) {
    return domainErr("inventory.mixed_items", "Kardex covers a single item", { items: [first.itemId, foreign.itemId] });
  }
  const currency = first.costMinor.currency;
  const openingValue = opts.openingValueMinor ?? Money.zero(currency);
  if (openingValue.currency !== currency) {
    return domainErr("inventory.currency_mismatch", "Opening value currency differs from movements", {
      opening: openingValue.currency,
      movements: currency,
    });
  }
  const allowNegative = opts.allowNegativeStock ?? false;
  let balance = opts.openingBalanceSsu ?? 0n;
  let value = openingValue;
  const rows: KardexRow[] = [];
  for (const m of sortChronologically(movements)) {
    balance += m.qtyDeltaSsu;
    if (balance < 0n && !allowNegative) {
      return domainErr("inventory.negative_balance", `Movement ${m.movementId} drives the running balance below zero`, {
        movementId: m.movementId,
        balanceSsu: balance.toString(),
      });
    }
    value = value.add(m.signedCostMinor());
    rows.push(
      Object.freeze({
        movement: m,
        qtyInSsu: m.isInbound() ? m.qtyDeltaSsu : 0n,
        qtyOutSsu: m.isInbound() ? 0n : -m.qtyDeltaSsu,
        balanceSsu: balance,
        costMinor: m.costMinor,
        balanceValueMinor: value,
      }),
    );
  }
  return ok(Object.freeze(rows));
}
