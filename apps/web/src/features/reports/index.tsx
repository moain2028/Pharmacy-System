import { useState, type ComponentType } from "react";
import { DICTS, useT } from "@/i18n";
import { PageHeader } from "@/components/ui";
import { reportsAr, reportsEn } from "./reports.keys";
import { SalesReport } from "./SalesReports";
import { ExpiryReport, SlowMovingReport, ValuationReport } from "./StockReports";
import { BalanceSheetReport, PnlReport, TrialBalanceReport } from "./FinanceReports";
import { AuditReport, CashbookReport, CustomerAgingReport, SupplierAgingReport } from "./PartyReports";

/** Registers feature keys without touching shared dictionaries (no-op if already merged). */
for (const [k, v] of Object.entries(reportsAr)) if (!(k in DICTS.ar)) DICTS.ar[k] = v;
for (const [k, v] of Object.entries(reportsEn)) if (!(k in DICTS.en)) DICTS.en[k] = v;

interface Tab { id: string; label: string; C: ComponentType }
const DEFAULT_TAB: Tab = { id: "sales", label: "reports.tab.sales", C: SalesReport };
const TABS: readonly Tab[] = [
  DEFAULT_TAB,
  { id: "inventory", label: "reports.tab.inventory", C: ValuationReport },
  { id: "expiry", label: "reports.tab.expiry", C: ExpiryReport },
  { id: "slow", label: "reports.tab.slow", C: SlowMovingReport },
  { id: "trial", label: "reports.tab.trial", C: TrialBalanceReport },
  { id: "pnl", label: "reports.tab.pnl", C: PnlReport },
  { id: "bs", label: "reports.tab.bs", C: BalanceSheetReport },
  { id: "custAging", label: "reports.tab.custAging", C: CustomerAgingReport },
  { id: "suppAging", label: "reports.tab.suppAging", C: SupplierAgingReport },
  { id: "cashbook", label: "reports.tab.cashbook", C: CashbookReport },
  { id: "audit", label: "reports.tab.audit", C: AuditReport },
];

const PRINT_CSS = "@media print{body *{visibility:hidden!important}.print-area,.print-area *{visibility:visible!important}.print-area{position:absolute;inset-inline-start:0;top:0;width:100%}.print-area .card{box-shadow:none;border:0}.no-print{display:none!important}}";

export default function ReportsPage() {
  const { t } = useT();
  const [tab, setTab] = useState(DEFAULT_TAB.id);
  const active = TABS.find((x) => x.id === tab) ?? DEFAULT_TAB;
  const Active = active.C;
  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print"><PageHeader title={t("nav.reports")} /></div>
      <div className="flex flex-col gap-4 md:flex-row">
        <nav aria-label={t("nav.reports")} className="no-print md:w-56 md:shrink-0">
          <ul className="flex flex-col gap-1">
            {TABS.map((x) => (
              <li key={x.id}>
                <button type="button" aria-current={x.id === active.id ? "page" : undefined} onClick={() => setTab(x.id)}
                  className={`w-full rounded-md px-3 py-2 text-start text-sm ${x.id === active.id ? "bg-brand-600 text-white" : "hover:bg-slate-100"}`}>
                  {t(x.label)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="print-area min-w-0 flex-1"><Active key={active.id} /></div>
      </div>
    </div>
  );
}
