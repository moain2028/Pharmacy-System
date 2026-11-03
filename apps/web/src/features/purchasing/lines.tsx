import { useT } from "@/i18n";
import { Field } from "@/components/ui";
import { fmtMinor } from "@/lib/money";
import { Input, integer, positiveMoney, record, text } from "@/features/procurement/shared";
import type { Pick } from "@/features/purchasing/SupplierItemPicker";
export interface Draft extends Pick { key: string; qty: string; cost: string; bonus: string; discountType: string; discountValue: string; lot: string; expiry: string; publicPrice: string; reason: string; poLineId?: string | undefined; grnLineId?: string | undefined }
export type Discount = { bp: number } | { amountMinor: string };
export function discount(type: string, value: string, currency: string): Discount | null | undefined { if (type === "none") return undefined; if (type === "bp") { const n = integer(value, 0, 10000); return n === null ? null : { bp: n }; } const n = positiveMoney(value, currency, true); return n === null ? null : { amountMinor: n }; }
export function newLine(p: Pick): Draft { return { ...p, key: crypto.randomUUID(), qty: "1", cost: "", bonus: "0", discountType: "none", discountValue: "", lot: "", expiry: "", publicPrice: "", reason: "" }; }
export interface PurchaseLine { itemId: string; unitId: string; qtyInUnit: number; unitCostMinor: string; bonusQtyInUnit: number; discount?: Discount | undefined }
export function linePayload(l: Draft, currency: string): PurchaseLine | null { const qty = integer(l.qty, 1); const bonus = integer(l.bonus); const cost = positiveMoney(l.cost, currency, true); const d = discount(l.discountType, l.discountValue, currency); return qty === null || bonus === null || cost === null || d === null || !l.itemId || !l.unitId ? null : { itemId: l.itemId, unitId: l.unitId, qtyInUnit: qty, unitCostMinor: cost, bonusQtyInUnit: bonus, ...(d ? { discount: d } : {}) }; }
// Detail endpoints do not document their SQL aliases. Keep compatibility isolated here.
export function fromDetail(value: unknown, currency: string, kind: "po" | "grn"): Draft | null {
  const r = record(value); const id = text(r["id"]); const itemId = text(r["itemId"] ?? r["item_id"]); const unitId = text(r["unitId"] ?? r["unit_id"]);
  const qty = kind === "po" ? r["remainingQtyInUnit"] ?? r["remaining_qty_in_unit"] ?? (r["received_qty_in_unit"] !== undefined ? Number(r["qty_in_unit"]) - Number(r["received_qty_in_unit"]) : undefined) : r["qtyInUnit"] ?? r["qty_in_unit"];
  const cost = text(r["unitCostMinor"] ?? r["unit_cost_minor"]);
  if (!id || !itemId || !unitId || integer(text(qty), 1) === null || !/^\d+$/.test(cost)) return null;
  return { ...newLine({ itemId, unitId, name: text(r["trade_name_ar"] ?? r["itemName"]) || itemId, unitName: text(r["unit_name_ar"]) || unitId }), key: id, qty: text(qty), cost: fmtMinor(cost, currency, "en", false), ...(kind === "po" ? { poLineId: id } : { grnLineId: id }) };
}
export function DiscountFields({ type, value, onChange }: { type: string; value: string; onChange: (type: string, value: string) => void }) { const { t } = useT(); return <div className="grid grid-cols-2 gap-2"><Field label={t("purchasing.discountType")}><select className="input" value={type} onChange={e => onChange(e.target.value, "")}><option value="none">{t("purchasing.none")}</option><option value="bp">{t("purchasing.bp")}</option><option value="amount">{t("common.amount")}</option></select></Field>{type !== "none" && <Input label={type === "bp" ? "purchasing.bp" : "common.discount"} value={value} onChange={v => onChange(type, v)} />}</div>; }
export function LineEditor({ line, onChange, onRemove, mode }: { line: Draft; onChange: (v: Draft) => void; onRemove: () => void; mode: "po" | "grn" | "invoice" }) {
  const { t } = useT(); const set = (key: keyof Draft, value: string) => onChange({ ...line, [key]: value });
  return <fieldset className="rounded border p-3 space-y-2"><legend>{line.name} <span className="text-slate-500">{line.unitName}</span></legend><div className="grid gap-2 sm:grid-cols-3"><Input label="common.quantity" value={line.qty} onChange={v => set("qty", v)} required /><Input label="purchasing.cost" value={line.cost} onChange={v => set("cost", v)} required />{mode !== "invoice" && <Input label="purchasing.bonus" value={line.bonus} onChange={v => set("bonus", v)} />}</div>{mode !== "grn" && <DiscountFields type={line.discountType} value={line.discountValue} onChange={(type, value) => onChange({ ...line, discountType: type, discountValue: value })} />}
    {mode === "grn" && <div className="grid gap-2 sm:grid-cols-3"><Input label="stock.lot" value={line.lot} onChange={v => set("lot", v)} required maxLength={60} /><Input label="stock.expiry" type="date" value={line.expiry} onChange={v => set("expiry", v)} /><Input label="purchasing.publicPrice" value={line.publicPrice} onChange={v => set("publicPrice", v)} /></div>}{mode === "invoice" && !line.grnLineId && <Input label="payables.unmatchedReason" value={line.reason} onChange={v => set("reason", v)} required />}
    <button type="button" className="btn-secondary" onClick={onRemove}>{t("common.delete")}</button></fieldset>;
}
