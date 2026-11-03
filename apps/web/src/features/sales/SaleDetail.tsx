import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { Receipt, type ReceiptProps } from "./Receipt";
import { METHOD_KEY, statusKey, statusTone, type SaleDetailDto, type SaleLine, type SaleLot } from "./types";

const lineName = (l: SaleLine, locale: "ar" | "en") => (locale === "ar" ? l.trade_name_ar : l.trade_name_en || l.trade_name_ar);
const unitName = (l: SaleLine, locale: "ar" | "en") => (locale === "ar" ? l.unit_name_ar : l.unit_name_en) ?? "";

export function toReceiptProps(d: SaleDetailDto, locale: "ar" | "en", pharmacyName: string): ReceiptProps {
  const i = d.invoice;
  return {
    pharmacyName, number: i.number, date: i.business_date, cashier: i.cashier_name ?? undefined, customer: i.customer_name ?? undefined, currency: i.currency,
    lines: d.lines.map((l) => ({ name: lineName(l, locale), qty: l.qty_in_unit, unit: unitName(l, locale), unitPriceMinor: l.unit_price_minor, totalMinor: l.total_minor })),
    subtotalMinor: i.gross_minor ?? i.total_minor, discountMinor: i.discount_minor, taxMinor: i.tax_minor, totalMinor: i.total_minor,
    tenders: d.payments.map((p) => ({ method: p.method, currency: p.currency, amountMinor: p.amount_minor })), changeMinor: i.change_minor, changeCurrency: i.change_currency,
  };
}

export default function SaleDetail() {
  const { id = "" } = useParams();
  const { t, locale } = useT();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["sales", id], queryFn: () => get<SaleDetailDto>(`/sales/${id}`), enabled: id !== "" });
  const lotsByLine = useMemo(() => {
    const m = new Map<string, SaleLot[]>();
    for (const l of q.data?.lots ?? []) m.set(l.line_id, [...(m.get(l.line_id) ?? []), l]);
    return m;
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return <Empty>{t("sales.notFound")}</Empty>;
  const inv = d.invoice;
  const cur = inv.currency;
  const Info = ({ k, v }: { k: string; v: string }) => <div><div className="text-xs text-slate-500">{k}</div><div className="num font-medium">{v}</div></div>;
  return (
    <>
      <div className="print:hidden">
        <PageHeader title={`${t("sales.detail")} ${inv.number}`} actions={<>
          <button className="btn-secondary" onClick={() => nav("/sales")}>{t("common.back")}</button>
          <button className="btn-secondary" onClick={() => window.print()}>{t("sales.printReceipt")}</button>
          <button className="btn-primary" disabled={inv.status !== "POSTED"} onClick={() => nav(`/returns?invoiceId=${inv.id}`)}>{t("sales.return")}</button>
        </>} />
        <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
          <Info k={t("common.date")} v={inv.business_date} />
          <Info k={t("pos.customer")} v={inv.customer_name ?? t("pos.walkIn")} />
          <Info k={t("sales.cashier")} v={inv.cashier_name ?? "—"} />
          <div><div className="text-xs text-slate-500">{t("common.status")}</div><Badge tone={statusTone(inv.status)}>{t(statusKey(inv.status))}</Badge></div>
          <Info k={t("common.total")} v={fmtMinor(inv.total_minor, cur, locale)} />
          <Info k={t("sales.paid")} v={fmtMinor(inv.paid_minor, cur, locale)} />
          <Info k={t("sales.credit")} v={fmtMinor(inv.credit_minor, cur, locale)} />
        </div>
        <div className="card mt-4"><div className="mb-2 font-medium">{t("sales.lines")}</div>
          <table><thead><tr><th>{t("sales.item")}</th><th>{t("common.quantity")}</th><th>{t("common.price")}</th><th>{t("common.discount")}</th><th>{t("common.total")}</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.id}>
                <td>{lineName(l, locale)}
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">{(lotsByLine.get(l.id) ?? []).map((lot) => (
                    <span key={lot.lot_id} className="num rounded bg-slate-100 px-1">{t("pos.lot")} {lot.lot_number} · {lot.expiry_date ?? "—"} · {lot.qty_ssu}</span>))}</div></td>
                <td className="num">{l.qty_in_unit} {unitName(l, locale)}</td>
                <td className="num">{fmtMinor(l.unit_price_minor, cur, locale)}</td>
                <td className="num">{fmtMinor(l.discount_minor ?? "0", cur, locale)}</td>
                <td className="num">{fmtMinor(l.total_minor, cur, locale)}</td>
              </tr>))}</tbody></table>
        </div>
        <div className="card mt-4"><div className="mb-2 font-medium">{t("sales.payments")}</div>
          {d.payments.length === 0 ? <Empty /> : (
            <table><thead><tr><th>{t("sales.method")}</th><th>{t("common.amount")}</th><th>{t("sales.ref")}</th></tr></thead>
              <tbody>{d.payments.map((p, i) => <tr key={i}><td>{t(METHOD_KEY[p.method] ?? "pos.cash")}</td><td className="num">{fmtMinor(p.amount_minor, p.currency, locale)}</td><td className="num">{p.payment_ref ?? "—"}</td></tr>)}</tbody></table>)}
        </div>
      </div>
      <div className="hidden print:block"><Receipt {...toReceiptProps(d, locale, t("app.name"))} /></div>
    </>
  );
}
