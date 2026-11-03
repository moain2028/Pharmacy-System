import { useT } from "@/i18n";
import { fmtMoney } from "@/lib/money";
import { Badge, ErrorBox, Spinner } from "@/components/ui";
import { METHOD_KEY } from "@/features/sales/types";
import type { ReturnQuote } from "./types";

const DEST_TONE: Record<string, "green" | "amber" | "red" | "slate"> = { AVAILABLE: "green", QUARANTINED: "amber", BLOCKED: "red" };

export function QuotePanel({ quote, loading, error }: { quote: ReturnQuote | undefined; loading: boolean; error: unknown }) {
  const { t, locale } = useT();
  if (error) return <ErrorBox error={error} />;
  if (!quote) return loading ? <Spinner /> : <div className="p-4 text-sm text-slate-500">{t("ret.noLines")}</div>;
  return (
    <div className={loading ? "opacity-60" : ""}>
      <div className="flex items-baseline justify-between"><span className="text-sm text-slate-500">{t("ret.refundTotal")}</span><span className="num text-2xl font-semibold">{fmtMoney(quote.refundTotal, locale)}</span></div>
      <div className="mt-3 text-sm font-medium">{t("ret.refunds")}</div>
      <table><tbody>{quote.refunds.map((r, i) => <tr key={i}><td>{t(METHOD_KEY[r.method] ?? "pos.cash")}</td><td className="num">{fmtMoney(r.amount, locale)}</td></tr>)}</tbody></table>
      <div className="mt-3 text-sm font-medium">{t("ret.lotDest")}</div>
      <table><thead><tr><th>{t("pos.lot")}</th><th>{t("common.quantity")}</th><th>{t("ret.destination")}</th></tr></thead>
        <tbody>{quote.lots.map((l, i) => (
          <tr key={i}><td className="num">{l.lotNumber ?? l.lotId.slice(0, 8)}</td><td className="num">{l.qtySsu}</td>
            <td><Badge tone={DEST_TONE[l.destination] ?? "slate"}>{t(`ret.dest${l.destination}`)}</Badge></td></tr>))}</tbody></table>
    </div>
  );
}
