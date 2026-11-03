import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, PageHeader, Spinner } from "@/components/ui";
import ItemDetail from "./ItemDetail";
import { ItemEditor } from "./ItemEditor";
import { rowsOf, type ItemRow } from "./types";

const LIMIT = 50;

function ItemsList() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [offset, setOffset] = useState(0);
  const [inactive, setInactive] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; id?: string | undefined }>({ open: false });
  useEffect(() => { const h = setTimeout(() => { setDq(q.trim()); setOffset(0); }, 250); return () => clearTimeout(h); }, [q]);
  const list = useQuery({
    queryKey: ["items", { q: dq, offset, inactive }],
    queryFn: () => get<ItemRow[] | { rows: ItemRow[] }>("/items", { q: dq || undefined, limit: LIMIT, offset, includeInactive: inactive || undefined }),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => rowsOf(list.data), [list.data]);
  return (
    <div>
      <PageHeader title={t("items.title")} actions={<button className="btn-primary" onClick={() => setEditor({ open: true })}>{t("items.new")}</button>} />
      <div className="card mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1"><Field label={t("common.search")}><input autoFocus className="input" placeholder={t("items.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setOffset(0); }} />{t("items.includeInactive")}</label>
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : rows.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto"><table>
          <thead><tr><th>{t("items.code")}</th><th>{t("item.tradeName")}</th><th>{t("items.generic")}</th><th>{t("items.strength")}</th><th>{t("items.rx")}</th><th>{t("item.taxBp")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-ink-50" onClick={() => nav(`/items/${r.id}`)}>
              <td className="num">{r.code}</td>
              <td><div>{locale === "ar" ? r.trade_name_ar : r.trade_name_en}</div><div className="text-xs text-ink-500">{locale === "ar" ? r.trade_name_en : r.trade_name_ar}</div></td>
              <td>{r.generic_name ?? "—"}</td><td>{[r.strength, r.dosage_form].filter(Boolean).join(" · ") || "—"}</td>
              <td>{r.rx_required && r.rx_required !== "NONE" ? <Badge tone="amber">{t(`items.rx.${r.rx_required}`)}</Badge> : <Badge>{t("items.rx.NONE")}</Badge>}</td>
              <td className="num">{(r.tax_bp ?? 0) / 100}%</td>
              <td><Badge tone={r.is_active ? "green" : "red"}>{t(r.is_active ? "common.active" : "common.inactive")}</Badge></td>
              <td><div className="flex gap-2">
                <button className="btn-secondary" aria-label={t("common.edit")} onClick={(e) => { e.stopPropagation(); setEditor({ open: true, id: r.id }); }}>{t("common.edit")}</button>
                <button className="btn-secondary" aria-label={t("items.open")} onClick={(e) => { e.stopPropagation(); nav(`/items/${r.id}`); }}>{t("items.open")}</button>
              </div></td>
            </tr>))}</tbody>
        </table></div>)}
      <div className="mt-3 flex items-center justify-between text-sm">
        <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}>{t("items.prev")}</button>
        <span className="num">{t("items.page", { n: offset / LIMIT + 1 })}</span>
        <button className="btn-secondary" disabled={rows.length < LIMIT} onClick={() => setOffset((o) => o + LIMIT)}>{t("common.next")}</button>
      </div>
      <ItemEditor open={editor.open} onClose={() => setEditor({ open: false })} itemId={editor.id} />
    </div>
  );
}

export default function ItemsPage() {
  return (
    <Routes>
      <Route index element={<ItemsList />} />
      <Route path=":id" element={<ItemDetail />} />
    </Routes>
  );
}
