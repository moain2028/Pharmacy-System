import { useTab } from "@/lib/useTab";
import { useT } from "@/i18n";
import { ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { useLocations } from "./ItemPicker";
import { AdjustForm, LotStatusForm, ReceiveForm, TransferForm } from "./forms";

const TABS = ["receive", "adjust", "transfer", "status"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { receive: "inv.tabReceive", adjust: "inv.tabAdjust", transfer: "inv.tabTransfer", status: "inv.tabLotStatus" };

export default function InventoryPage() {
  const { t } = useT();
  const [tab, setTab] = useTab<Tab>(TABS);
  const locs = useLocations();
  const locations = locs.data ?? [];
  const body = () => {
    if (locs.isLoading) return <Spinner />;
    if (locs.error) return <ErrorBox error={locs.error} onRetry={() => void locs.refetch()} />;
    switch (tab) {
      case "receive": return <ReceiveForm locations={locations} />;
      case "adjust": return <AdjustForm locations={locations} />;
      case "transfer": return <TransferForm locations={locations} />;
      case "status": return <LotStatusForm locations={locations} />;
    }
  };
  return (
    <div>
      <PageHeader title={t("inv.title")} />
      <div role="tablist" aria-label={t("inv.title")} className="mb-4 flex flex-wrap gap-1 border-b border-ink-200">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm ${tab === k ? "border-b-2 border-brand-600 font-medium text-brand-700" : "text-ink-500 hover:text-ink-800"}`}>
            {t(LABEL[k])}
          </button>
        ))}
      </div>
      <div role="tabpanel">{body()}</div>
    </div>
  );
}
