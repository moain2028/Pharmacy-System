import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { fmtMoney } from "@/lib/money";
import { ErrorBox, Modal, Empty, toast } from "@/components/ui";
import { usePosT } from "./pos.keys";
import PosSearch from "./PosSearch";
import Cart from "./Cart";
import PayModal from "./PayModal";
import ShiftBar from "./ShiftBar";
import { buildBody, loadHeld, newKey, saveHeld, useCart, useDebounced, type HeldCart, type ItemDetail, type Quote } from "./useCart";

/** Point of sale: scan/search → cart → live quote → pay. Hotkeys: F2 focus search, F9 pay, F4 hold, Esc close modals. */
export default function PosPage() {
  const { t, locale } = usePosT();
  const searchRef = useRef<HTMLInputElement>(null);
  const cashboxRef = useRef<HTMLSelectElement>(null);
  const cart = useCart();
  const [paying, setPaying] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [held, setHeld] = useState<HeldCart[]>(() => loadHeld());

  const snapshot = useMemo(() => ({ lines: cart.lines, customer: cart.customer, invoiceDiscountBp: cart.invoiceDiscountBp }), [cart.lines, cart.customer, cart.invoiceDiscountBp]);
  const body = useMemo(() => buildBody(snapshot), [snapshot]);
  const quoteKey = useDebounced(JSON.stringify(body), 200);
  const quote = useQuery({
    queryKey: ["sales-quote", quoteKey],
    queryFn: () => post<Quote>("/sales/quote", JSON.parse(quoteKey) as unknown),
    enabled: body.lines.length > 0,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const addItem = useCallback(async (itemId: string, unitId?: string): Promise<void> => {
    const it = await get<ItemDetail>(`/items/${itemId}`);
    const sellable = it.units.filter((u) => u.can_sell);
    const unit = sellable.find((u) => u.id === unitId) ?? sellable.find((u) => u.is_default_sale) ?? sellable[0];
    if (!unit) { toast.err(t("pos.noSellUnit")); return; }
    useCart.getState().add({ itemId: it.id, nameAr: it.trade_name_ar, nameEn: it.trade_name_en, unitId: unit.id, unitName: locale === "ar" ? unit.name_ar : unit.name_en, factor: unit.factor_to_ssu, qtyInUnit: 1 });
    searchRef.current?.focus();
  }, [locale, t]);

  const hold = useCallback(() => {
    const s = useCart.getState();
    if (s.lines.length === 0) { toast.info(t("pos.nothingToHold")); return; }
    const list = [{ id: newKey(), at: new Date().toISOString(), snapshot: { lines: s.lines, customer: s.customer, invoiceDiscountBp: s.invoiceDiscountBp } }, ...loadHeld()].slice(0, 20);
    saveHeld(list); setHeld(list); s.reset(); toast.ok(t("pos.heldOk")); searchRef.current?.focus();
  }, [t]);

  const resume = (h: HeldCart) => {
    const list = loadHeld().filter((x) => x.id !== h.id);
    saveHeld(list); setHeld(list); useCart.getState().load(h.snapshot); setHeldOpen(false); searchRef.current?.focus();
  };

  const clear = () => { if (cart.lines.length === 0 || window.confirm(t("pos.confirmClear"))) { cart.reset(); searchRef.current?.focus(); } };
  const openPay = useCallback(() => { if (useCart.getState().lines.length > 0) setPaying(true); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F9") { e.preventDefault(); openPay(); }
      else if (e.key === "F4") { e.preventDefault(); hold(); }
      else if (e.key === "Escape") { setPaying(false); setHeldOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPay, hold]);

  const total = quote.data?.totals.total;
  return (
    <div className="space-y-3">
      <ShiftBar selectRef={cashboxRef} />
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          <PosSearch inputRef={searchRef} onPick={addItem} />
          {quote.error && <ErrorBox error={quote.error} onRetry={() => void quote.refetch()} />}
          <Cart quote={quote.data} />
        </div>
        <aside className="card sticky top-3 h-fit space-y-3" aria-label={t("pos.total")}>
          <div className="text-sm text-slate-500">{t("pos.total")}</div>
          <div className="num text-4xl font-bold">{total ? fmtMoney(total, locale) : "—"}</div>
          {quote.isFetching && <div className="text-xs text-slate-400">{t("pos.recalc")}</div>}
          {(quote.data?.warnings.length ?? 0) > 0 && (
            <ul className="space-y-1 text-xs text-amber-700">{quote.data?.warnings.map((w, i) => <li key={i}>⚠ {t(`warn.${w.code}`) === `warn.${w.code}` ? w.code : t(`warn.${w.code}`)}</li>)}</ul>
          )}
          <button className="btn-primary w-full py-3 text-lg" disabled={cart.lines.length === 0 || !total} onClick={openPay}>{t("pos.pay")}</button>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <button className="btn-secondary" onClick={hold}>{t("pos.hold")}</button>
            <button className="btn-secondary" onClick={() => setHeldOpen(true)}>{t("pos.heldList")} <span className="num">({held.length})</span></button>
            <button className="btn-secondary" onClick={clear}>{t("pos.clear")}</button>
          </div>
        </aside>
      </div>

      {paying && total && (
        <PayModal body={body} total={total} idempotencyKey={cart.idempotencyKey} customer={cart.customer} lines={cart.lines}
          onClose={() => setPaying(false)} onDone={() => { setPaying(false); cart.reset(); searchRef.current?.focus(); }}
          onNoShift={() => { setPaying(false); toast.err(t("pos.noShift")); cashboxRef.current?.focus(); }} />
      )}

      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title={t("pos.heldList")}>
        {held.length === 0 ? <Empty>{t("pos.noHeld")}</Empty> : (
          <ul className="divide-y">
            {held.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span><span className="num">{new Date(h.at).toLocaleTimeString(locale)}</span> · {h.snapshot.customer?.name ?? t("pos.walkIn")} · <span className="num">{h.snapshot.lines.length}</span> {t("pos.item")}</span>
                <button className="btn-primary" onClick={() => resume(h)}>{t("pos.resume")}</button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
