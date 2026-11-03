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
  const warnLabel = (code: string) => { const k = `warn.${code}`; const v = t(k); return v === k ? code : v; };
  const lineCount = cart.lines.reduce((a, l) => a + l.qtyInUnit, 0);
  return (
    <div className="space-y-3 pb-28 lg:pb-0">
      <ShiftBar selectRef={cashboxRef} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-3">
          <div className="sticky top-[calc(var(--topbar-h)+.25rem)] z-10 -mx-3 bg-ink-50/95 px-3 py-2 backdrop-blur sm:static sm:m-0 sm:bg-transparent sm:p-0">
            <PosSearch inputRef={searchRef} onPick={addItem} />
          </div>
          {quote.error && <ErrorBox error={quote.error} onRetry={() => void quote.refetch()} />}
          <Cart quote={quote.data} />
        </div>

        {/* Desktop summary column */}
        <aside className="hidden lg:block" aria-label={t("pos.total")}>
          <div className="card sticky top-[calc(var(--topbar-h)+1.5rem)] space-y-4">
            <div>
              <div className="text-xs font-semibold text-ink-500">{t("pos.total")}</div>
              <div className="num mt-1 text-4xl font-extrabold leading-none text-ink-900">{total ? fmtMoney(total, locale) : "—"}</div>
              <div className="mt-1 text-xs text-ink-500">{cart.lines.length} {t("pos.item")} · <span className="num">{lineCount}</span> {t("common.quantity")}{quote.isFetching ? ` · ${t("pos.recalc")}` : ""}</div>
            </div>
            {(quote.data?.warnings.length ?? 0) > 0 && (
              <ul className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{quote.data?.warnings.map((w, i) => <li key={i}>⚠ {warnLabel(w.code)}</li>)}</ul>
            )}
            <button className="btn-primary w-full py-3 text-lg" disabled={cart.lines.length === 0 || !total} onClick={openPay}>{t("pos.pay")}</button>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-secondary btn-sm" onClick={hold}>{t("pos.hold")}</button>
              <button className="btn-secondary btn-sm" onClick={() => setHeldOpen(true)}>{t("pos.heldList")} <span className="num">({held.length})</span></button>
              <button className="btn-ghost btn-sm text-rose-700" onClick={clear}>{t("pos.clear")}</button>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-ink-100 pt-3 text-[11px] text-ink-500">
              <span><span className="kbd">F2</span> {t("common.search")}</span><span><span className="kbd">F4</span> {t("pos.hold")}</span><span><span className="kbd">F9</span> {t("pos.pay")}</span><span><span className="kbd">Esc</span> {t("common.close")}</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Phone / tablet: pinned pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-200/80 bg-white/95 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-pop backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-ink-500">{t("pos.total")} · {cart.lines.length} {t("pos.item")}</div>
            <div className="num truncate text-2xl font-extrabold leading-tight">{total ? fmtMoney(total, locale) : "—"}</div>
          </div>
          <button className="btn-secondary btn-icon" aria-label={t("pos.heldList")} onClick={() => setHeldOpen(true)}><span className="num text-sm font-bold">{held.length}</span></button>
          <button className="btn-secondary btn-icon" aria-label={t("pos.hold")} onClick={hold}>⏸</button>
          <button className="btn-primary h-12 px-6 text-base" disabled={cart.lines.length === 0 || !total} onClick={openPay}>{t("pos.pay")}</button>
        </div>
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
