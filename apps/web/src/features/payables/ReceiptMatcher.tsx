import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Empty, ErrorBox, Spinner } from "@/components/ui";
import { RemoteSelect } from "@/features/procurement/shared";
import { fromDetail } from "@/features/purchasing/lines";
import type { Draft } from "@/features/purchasing/lines";
export default function ReceiptMatcher({ supplierId, currency, selected, onToggle }: { supplierId: string; currency: string; selected: Draft[]; onToggle: (line: Draft, checked: boolean) => void }) {
  const { t } = useT(); const [receiptId, setReceipt] = useState(""); const q = useQuery({ queryKey: ["/goods-receipts", receiptId], queryFn: () => get<{ lines: unknown[] }>(`/goods-receipts/${receiptId}`), enabled: Boolean(receiptId) });
  const lines = useMemo(() => (q.data?.lines ?? []).map(v => fromDetail(v, currency, "grn")).filter((v): v is Draft => v !== null), [q.data, currency]);
  return <div className="rounded border p-3 space-y-2"><RemoteSelect path="/goods-receipts" supplierId={supplierId} label="payables.receipt" value={receiptId} onChange={setReceipt} />{q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}{q.data && !lines.length && <Empty />}{lines.map(l => <label className="flex items-center gap-2" key={l.key}><input type="checkbox" checked={selected.some(s => s.grnLineId === l.grnLineId)} onChange={e => onToggle(l, e.target.checked)} /><span>{t("payables.match")}: {l.name} <span className="num">{l.qty}</span></span></label>)}</div>;
}
