import { useState, type KeyboardEvent, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { toast } from "@/components/ui";
import { usePosT } from "./pos.keys";
import { rowsOf, useDebounced, type ItemRow } from "./useCart";

interface Parsed { kind: string; itemId?: string | null; unitId?: string | null }
const looksLikeCode = (s: string) => /^\d{8,14}$/.test(s) || /^(\]C1|\(01\)|01\d{14})/.test(s) || s.includes("\u001d");

interface Props { inputRef: RefObject<HTMLInputElement>; onPick: (itemId: string, unitId?: string) => Promise<void> }

export default function PosSearch({ inputRef, onPick }: Props) {
  const { t, locale } = usePosT();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ["pos-items", dq],
    queryFn: async () => rowsOf(await get<ItemRow[] | { rows?: ItemRow[] }>("/items", { q: dq, limit: 20 })),
    enabled: dq.length >= 2 && !looksLikeCode(dq),
  });
  const rows = q.trim() ? res.data ?? [] : [];

  // Scanner path: not debounced — resolves the code immediately on Enter.
  const scan = async (code: string): Promise<void> => {
    try {
      const p = await get<Parsed>("/barcodes/parse", { code }).catch(() => null);
      if (p?.itemId) { await onPick(p.itemId, p.unitId ?? undefined); return; }
      const hit = rowsOf(await get<ItemRow[] | { rows?: ItemRow[] }>("/items", { barcode: code, limit: 1 }))[0];
      if (hit) { await onPick(hit.id); return; }
      toast.err(t("pos.itemNotFound"));
    } catch (e) { toast.err(e instanceof Error ? e.message : t("common.error")); }
  };

  const pick = (id: string) => { setQ(""); setHi(0); void onPick(id); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const s = q.trim();
      if (!s) return;
      if (looksLikeCode(s)) { setQ(""); void scan(s); return; }
      const r = rows[hi] ?? rows[0];
      if (r) pick(r.id);
    }
  };

  const showNone = q.trim().length >= 2 && dq === q.trim() && !looksLikeCode(dq) && res.isSuccess && rows.length === 0;
  return (
    <div className="relative">
      <input ref={inputRef} autoFocus role="combobox" aria-expanded={rows.length > 0} aria-controls="pos-results" aria-label={t("pos.scanOrSearch")}
        placeholder={t("pos.scanOrSearch")} className="input w-full text-lg" value={q} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} />
      {showNone && <div className="absolute z-20 mt-1 w-full rounded-md border bg-white p-3 text-sm text-ink-500 shadow">{t("pos.noResults")}</div>}
      {rows.length > 0 && (
        <ul id="pos-results" role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border bg-white shadow">
          {rows.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(r.id); }}
              className={`flex cursor-pointer justify-between gap-2 px-3 py-2 ${i === hi ? "bg-ink-100" : ""}`}>
              <span>{locale === "ar" ? r.trade_name_ar : r.trade_name_en}</span>
              <span className="num text-xs text-ink-500">{[r.strength, r.code].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
