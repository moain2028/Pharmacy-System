import { useT } from "@/i18n";
import type { SaleLine } from "@/features/sales/types";
import type { QtyMode } from "./types";

interface Props { lines: SaleLine[]; returned: Record<string, number>; qty: Record<string, string>; errors: Record<string, string>; mode: QtyMode; onQty: (id: string, v: string) => void }

export function ReturnLines({ lines, returned, qty, errors, mode, onQty }: Props) {
  const { t, locale } = useT();
  const name = (l: SaleLine) => (locale === "ar" ? l.trade_name_ar : l.trade_name_en || l.trade_name_ar);
  const unit = (l: SaleLine) => (locale === "ar" ? l.unit_name_ar : l.unit_name_en) ?? t("common.unit");
  const fmtQ = (ssu: number, l: SaleLine) => {
    const f = Number(l.factor_to_ssu) || 1;
    return f > 1 ? `${ssu} (${(ssu / f).toLocaleString("en", { maximumFractionDigits: 2 })} ${unit(l)})` : String(ssu);
  };
  return (
    <table>
      <thead><tr><th>{t("sales.item")}</th><th>{t("ret.sold")}</th><th>{t("ret.returned")}</th><th>{t("ret.returnable")}</th><th>{t("ret.returnQty")} ({mode === "SSU" ? t("ret.inSsu") : t("ret.inUnit")})</th></tr></thead>
      <tbody>{lines.map((l) => {
        const sold = Number(l.qty_ssu); const ret = returned[l.id] ?? 0; const max = sold - ret; const err = errors[l.id];
        return (
          <tr key={l.id}>
            <td>{name(l)}<div className="text-xs text-slate-500">{t("item.factor")}: <span className="num">{l.factor_to_ssu}</span></div></td>
            <td className="num">{fmtQ(sold, l)}</td><td className="num">{fmtQ(ret, l)}</td><td className="num font-medium">{fmtQ(max, l)}</td>
            <td>
              <input type="number" inputMode="decimal" min={0} step={mode === "SSU" ? 1 : "any"} className={`input num w-28 ${err ? "border-red-500" : ""}`} aria-label={`${t("ret.returnQty")} ${name(l)}`}
                value={qty[l.id] ?? ""} disabled={max <= 0} onChange={(e) => onQty(l.id, e.target.value)} />
              {err && <div role="alert" className="mt-1 text-xs text-red-600">{t(err)}</div>}
            </td>
          </tr>);
      })}</tbody>
    </table>
  );
}
