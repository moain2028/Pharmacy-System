import { useT } from "@/i18n";
import { fmtMinor } from "@/lib/money";
import { METHOD_KEY } from "./types";

export interface ReceiptLine { name: string; qty: number | string; unit?: string | undefined; unitPriceMinor: string; totalMinor: string }
export interface ReceiptTender { method: string; currency: string; amountMinor: string }
export interface ReceiptProps {
  pharmacyName: string; number: string; date: string; cashier?: string | undefined; customer?: string | undefined; currency: string;
  lines: ReceiptLine[]; subtotalMinor: string; discountMinor?: string | undefined; taxMinor?: string | undefined; totalMinor: string;
  tenders: ReceiptTender[]; changeMinor?: string | undefined; changeCurrency?: string | undefined;
}

/** Compact 80mm receipt. Pure presentational: used by Sales history and POS. */
export function Receipt(p: ReceiptProps) {
  const { t, locale, dir } = useT();
  const m = (v: string, c: string = p.currency) => fmtMinor(v, c, locale);
  const row = (label: string, v: string, bold = false) => (
    <div className={`flex justify-between gap-2 ${bold ? "text-sm font-bold" : ""}`}><span>{label}</span><span className="num">{v}</span></div>
  );
  const nz = (v: string | undefined): v is string => v !== undefined && v !== "0";
  return (
    <div dir={dir} className="receipt mx-auto w-[80mm] bg-white p-2 font-mono text-[11px] leading-tight text-black">
      <div className="text-center text-sm font-bold">{p.pharmacyName}</div>
      <div className="mt-1 border-b border-dashed border-black pb-1">
        {row(t("sales.number"), p.number)}{row(t("common.date"), p.date)}
        {p.cashier ? row(t("sales.cashier"), p.cashier) : null}{p.customer ? row(t("pos.customer"), p.customer) : null}
      </div>
      <table className="w-full text-[11px]">
        <thead><tr><th className="text-start">{t("sales.item")}</th><th className="text-end">{t("common.quantity")}</th><th className="text-end">{t("common.price")}</th><th className="text-end">{t("common.total")}</th></tr></thead>
        <tbody>{p.lines.map((l, i) => (
          <tr key={i}><td className="text-start">{l.name}</td><td className="num text-end">{l.qty}{l.unit ? ` ${l.unit}` : ""}</td>
            <td className="num text-end">{fmtMinor(l.unitPriceMinor, p.currency, locale, false)}</td><td className="num text-end">{fmtMinor(l.totalMinor, p.currency, locale, false)}</td></tr>
        ))}</tbody>
      </table>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {row(t("pos.subtotal"), m(p.subtotalMinor))}
        {nz(p.discountMinor) ? row(t("common.discount"), m(p.discountMinor)) : null}
        {nz(p.taxMinor) ? row(t("pos.tax"), m(p.taxMinor)) : null}
        {row(t("pos.total"), m(p.totalMinor), true)}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {p.tenders.map((x, i) => <div key={i}>{row(t(METHOD_KEY[x.method] ?? "pos.cash"), m(x.amountMinor, x.currency))}</div>)}
        {nz(p.changeMinor) ? row(t("pos.change"), m(p.changeMinor, p.changeCurrency ?? p.currency)) : null}
      </div>
      <div className="mt-2 text-center">{t("sales.thanks")}</div>
    </div>
  );
}
export default Receipt;
