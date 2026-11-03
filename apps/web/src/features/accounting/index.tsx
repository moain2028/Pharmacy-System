import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { useAT } from "./util";
import { CoaTab } from "./CoaTab";
import { OpeningTab } from "./OpeningTab";
import { RatesTab } from "./RatesTab";

type Tab = "coa" | "opening" | "rates";

export default function AccountingPage() {
  const { t } = useAT();
  const [tab, setTab] = useState<Tab>("coa");
  return (
    <div>
      <PageHeader title={t("acc.title")} />
      <div role="tablist" className="mb-3 flex flex-wrap gap-2">
        {(["coa", "opening", "rates"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "btn-primary" : "btn-secondary"} onClick={() => setTab(k)}>{t(`acc.tab.${k}`)}</button>
        ))}
      </div>
      {tab === "coa" ? <CoaTab /> : tab === "opening" ? <OpeningTab /> : <RatesTab />}
    </div>
  );
}
