import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMoney } from "@/lib/money";
import { Badge, Empty } from "@/components/ui";
import { usePosT } from "./pos.keys";
import { pctToBp, rowsOf, useCart, useDebounced, warnCode, type CartLine, type ItemDetail, type Quote, type QuoteLine } from "./useCart";

interface CustomerRow { id: string; code: string; name: string; phone?: string | null; is_walk_in: boolean }

function PctInput({ value, onChange, label }: { value: number; onChange: (bp: number) => void; label: string }) {
  const [text, setText] = useState("");
  const shown = pctToBp(text) === value ? text : value ? String(value / 100) : "";
  return (
    <input aria-label={label} className="input num w-20" inputMode="decimal" value={shown}
      onChange={(e) => { setText(e.target.value); const bp = pctToBp(e.target.value); if (bp !== null) onChange(bp); }} />
  );
}

function CustomerPicker() {
  const { t } = usePosT();
  const customer = useCart((s) => s.customer);
  const setCustomer = useCart((s) => s.setCustomer);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ["customers", "pos", dq],
    queryFn: async () => rowsOf(await get<CustomerRow[] | { rows?: CustomerRow[] }>("/customers", { q: dq, limit: 10 })),
    enabled: dq.length >= 2,
  });
  const list = q.trim() ? res.data ?? [] : [];
  return (
    <div className="relative flex items-center gap-2 text-sm">
      <span className="text-ink-500">{t("pos.customer")}:</span>
      <Badge tone={customer ? "blue" : "slate"}>{customer?.name ?? t("pos.walkIn")}</Badge>
      {customer && <button type="button" aria-label={t("pos.walkIn")} className="text-ink-400 hover:text-ink-700" onClick={() => setCustomer(null)}>✕</button>}
      <input aria-label={t("pos.searchCustomer")} placeholder={t("pos.searchCustomer")} className="input w-48" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length > 0 && (
        <ul className="absolute end-0 top-full z-10 mt-1 w-64 rounded-md border bg-white shadow">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-1 text-start hover:bg-ink-100"
                onClick={() => { setCustomer(c.is_walk_in ? null : { id: c.id, name: c.name }); setQ(""); }}>
                {c.name} <span className="num text-xs text-ink-500">{c.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineRow({ line, ql }: { line: CartLine; ql: QuoteLine | undefined }) {
  const { t, locale } = usePosT();
  const { setQty, setUnit, setLineDiscount, remove } = useCart.getState();
  const d = useQuery({ queryKey: ["item", line.itemId], queryFn: () => get<ItemDetail>(`/items/${line.itemId}`), staleTime: 60_000 });
  const units = (d.data?.units ?? []).filter((u) => u.can_sell);
  const uName = (u: { name_ar: string; name_en: string }) => (locale === "ar" ? u.name_ar : u.name_en);
  return (
    <tr>
      <td>
        <div className="font-medium">{locale === "ar" ? line.nameAr : line.nameEn}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {ql?.allocations.map((a) => (
            <Badge key={a.lotId} tone="blue">{t("pos.lot")} <span className="num">{a.lotNumber ?? "—"}</span> · {t("pos.expiry")} <span className="num">{a.expiryDate ?? "—"}</span></Badge>
          ))}
          {ql?.warnings.map((w, i) => <Badge key={`w${i}`} tone="amber">{t(warnCode(w))}</Badge>)}
        </div>
      </td>
      <td>
        <select aria-label={t("common.unit")} className="input" value={line.unitId}
          onChange={(e) => { const u = units.find((x) => x.id === e.target.value); if (u) setUnit(line.key, u.id, uName(u), u.factor_to_ssu); }}>
          {units.length ? units.map((u) => <option key={u.id} value={u.id}>{uName(u)}</option>) : <option value={line.unitId}>{line.unitName}</option>}
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t("pos.qtyDec")} className="btn-secondary px-2" onClick={() => setQty(line.key, line.qtyInUnit - 1)}>−</button>
          <input aria-label={t("common.quantity")} className="input num w-16 text-center" inputMode="numeric" value={line.qtyInUnit}
            onFocus={(e) => e.target.select()}
            onChange={(e) => { const n = Number.parseInt(e.target.value, 10); if (Number.isInteger(n) && n > 0) setQty(line.key, n); }} />
          <button type="button" aria-label={t("pos.qtyInc")} className="btn-secondary px-2" onClick={() => setQty(line.key, line.qtyInUnit + 1)}>+</button>
        </div>
      </td>
      <td><PctInput label={t("pos.lineDiscPct")} value={line.lineDiscountBp ?? 0} onChange={(bp) => setLineDiscount(line.key, bp || undefined)} /></td>
      <td className="num">{ql ? fmtMoney(ql.total, locale) : "…"}</td>
      <td><button type="button" aria-label={t("pos.remove")} className="text-danger-500 hover:text-danger-700" onClick={() => remove(line.key)}>✕</button></td>
    </tr>
  );
}

export default function Cart({ quote }: { quote: Quote | undefined }) {
  const { t } = usePosT();
  const lines = useCart((s) => s.lines);
  const invBp = useCart((s) => s.invoiceDiscountBp);
  const setInv = useCart((s) => s.setInvoiceDiscount);
  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("pos.cart")} <span className="num text-ink-500">({lines.length})</span></h2>
        <CustomerPicker />
      </div>
      {lines.length === 0 ? <Empty>{t("pos.empty")}</Empty> : (
        <table className="w-full">
          <thead><tr><th>{t("pos.item")}</th><th>{t("common.unit")}</th><th>{t("common.quantity")}</th><th>{t("pos.lineDiscPct")}</th><th>{t("pos.lineTotal")}</th><th><span className="sr-only">{t("common.actions")}</span></th></tr></thead>
          <tbody>{lines.map((l, i) => <LineRow key={l.key} line={l} ql={quote?.lines[i]} />)}</tbody>
        </table>
      )}
      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <span>{t("pos.invDiscPct")}</span>
        <PctInput label={t("pos.invDiscPct")} value={invBp} onChange={setInv} />
      </div>
    </div>
  );
}
